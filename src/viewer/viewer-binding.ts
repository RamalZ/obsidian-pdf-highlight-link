import { Notice } from "obsidian";
import type { KeymapEventHandler, Scope, TFile, WorkspaceLeaf } from "obsidian";
import type PdfHighlightLinkPlugin from "../main.ts";
import type { BvLike, HighlightEntry, HighlightMode, NormRect, PdfEventBusLike } from "../types.ts";
import { buildHighlightIndex } from "../core/backlink-index.ts";
import {
  buildLinkAlias,
  buildReferenceBlock,
  copyTextToClipboard,
  createPdfLink,
} from "../core/link.ts";
import { FloatToolbar } from "./float-toolbar.ts";
import { HighlightRenderer } from "./highlight-renderer.ts";
import { createModeButtons, type ModeButtonsHandle } from "./mode-buttons.ts";
import {
  clearDegenerateNativeHighlight,
  ensureApplySubpathPatch,
  getEventBus,
  getViewerContainer,
  isViewerAlive,
} from "./pdf-viewer-api.ts";
import { RectCapture } from "./rect-capture.ts";
import { SelectionCapture } from "./selection-capture.ts";

type PendingSelection =
  | { kind: "text"; page: number; rect: NormRect; alias: string }
  | { kind: "rect"; page: number; rect: NormRect };

interface ViewerEventPayload {
  pageNumber?: number;
}

/**
 * 单个 PDF 叶子的绑定：工具栏按钮、选区/框选交互、高亮渲染、事件订阅。
 * 生命周期由 ViewerManager 管理；destroy 后不再持有 DOM 引用。
 */
export class ViewerBinding {
  readonly leaf: WorkspaceLeaf;
  readonly bv: BvLike;

  private plugin: PdfHighlightLinkPlugin;
  private container: HTMLElement;
  private renderer: HighlightRenderer;
  private toolbar: FloatToolbar | null = null;
  private modeButtons: ModeButtonsHandle | null = null;
  private selectionCapture: SelectionCapture | null = null;
  private rectCapture: RectCapture | null = null;
  private entries: HighlightEntry[] = [];
  private pending: PendingSelection | null = null;
  private busHandlers: Array<{ event: string; handler: (payload?: ViewerEventPayload) => void }> = [];
  private refreshTimer: number | null = null;
  private flashTimer: number | null = null;
  private pendingFlashId: string | null = null;
  private flashAttempts = 0;
  private scopeRef: Scope | null = null;
  private scopeHandler: KeymapEventHandler | null = null;
  private scrollHandler: (() => void) | null = null;
  private bus: PdfEventBusLike | null = null;
  /** 上一次刷新时的文件路径，用于在同叶子内换文件时自动重建索引 */
  private lastFilePath: string | null = null;
  /** 异步索引的序号，避免旧请求返回后覆盖新结果 */
  private refreshToken = 0;
  private destroyed = false;

  constructor(plugin: PdfHighlightLinkPlugin, leaf: WorkspaceLeaf, bv: BvLike) {
    this.plugin = plugin;
    this.leaf = leaf;
    this.bv = bv;
    this.container = getViewerContainer(bv);
    this.renderer = new HighlightRenderer(bv);
    this.renderer.setStyle(plugin.getColorHex(), plugin.settings.opacity);
    this.setup();
  }

  // -------------------------------------------------------------------------
  // 初始化
  // -------------------------------------------------------------------------

  private setup(): void {
    // 1) 先修原生浮点 selection 高亮（越早越好，避免页首文本被清空）
    ensureApplySubpathPatch(this.bv);
    clearDegenerateNativeHighlight(this.bv);

    // 2) 工具栏按钮（工具栏可能在窗口迁移后重建，事件里会再补）
    this.ensureModeButtons();

    // 3) 交互捕获
    this.selectionCapture = new SelectionCapture(
      this.bv,
      this.container,
      () => !this.destroyed && this.plugin.getMode() === "text",
      (result) => {
        if (!result) {
          this.hideToolbar();
          return;
        }
        this.pending = { kind: "text", page: result.page, rect: result.rect, alias: result.alias };
        this.showToolbar(result.anchor);
      },
    );
    this.selectionCapture.start();

    this.rectCapture = new RectCapture(
      this.container,
      () => !this.destroyed && this.plugin.getMode() === "rect",
      (result) => {
        if (!result) {
          this.hideToolbar();
          return;
        }
        this.pending = { kind: "rect", page: result.page, rect: result.rect };
        this.showToolbar(result.anchor);
      },
    );
    this.rectCapture.start();

    // 4) 滚动时收起浮动工具栏
    this.scrollHandler = () => this.hideToolbar();
    this.container.addEventListener("scroll", this.scrollHandler, { passive: true });

    // 5) 视图事件
    this.bindViewerEvents();

    // 6) 快捷键：T 切文字模式（仅 PDF 叶子获得焦点时生效）
    this.registerScopeShortcut();

    this.applyModeVisual();
    this.refresh();
  }

  private bindViewerEvents(): void {
    const bus = getEventBus(this.bv);
    if (!bus) {
      // 拿不到总线时只降级（不订阅），不影响手动刷新与选区交互
      console.debug("[pdfhl] 未找到 PDF 事件总线，缩略图/懒加载后不会自动重绘（可手动执行「刷新高亮」）");
      return;
    }
    this.bus = bus;

    const on = (event: string, handler: (payload?: ViewerEventPayload) => void) => {
      try {
        bus.on(event, handler);
        this.busHandlers.push({ event, handler });
      } catch (error) {
        console.warn(`[pdfhl] 订阅 ${event} 失败`, error);
      }
    };

    on("documentloaded", () => {
      this.ensureModeButtons();
      this.clearDegenerateNativeHighlightIfNeeded();
      this.refresh();
    });
    on("pagesloaded", () => {
      this.ensureModeButtons();
      this.renderer.ensureLayers();
    });
    on("pagerendered", () => {
      this.renderer.ensureLayers();
      this.tryFlash();
    });
    on("textlayerrendered", () => {
      // 兜底：applySubpath 补丁失效时，清理重新出现的退化高亮
      this.clearDegenerateNativeHighlightIfNeeded();
    });
  }

  private clearDegenerateNativeHighlightIfNeeded(): void {
    if (clearDegenerateNativeHighlight(this.bv)) {
      console.debug("[pdfhl] 已清除原生退化高亮（浮点 selection）");
    }
  }

  private registerScopeShortcut(): void {
    const view = this.leaf.view as unknown as { scope?: Scope };
    const scope = view.scope;
    if (!scope || typeof scope.register !== "function") return;
    this.scopeRef = scope;
    this.scopeHandler = scope.register([], "t", () => {
      // 与工具栏按钮一致：在文字模式与无模式之间切换
      this.plugin.toggleMode("text");
      return false;
    });
  }

  private ensureModeButtons(): void {
    const toolbarRight = this.bv.toolbar?.toolbarRightEl;
    if (!toolbarRight) return;
    if (this.modeButtons?.isAttached()) return;
    this.modeButtons?.destroy();
    this.modeButtons = createModeButtons(toolbarRight, this.plugin.getMode(), (mode) => {
      // 三态切换：再点已激活的模式即退出到无模式
      this.plugin.toggleMode(mode);
    });
  }

  // -------------------------------------------------------------------------
  // 模式 / 样式
  // -------------------------------------------------------------------------

  applyModeVisual(): void {
    if (this.destroyed) return;
    const mode = this.plugin.getMode();
    this.modeButtons?.setMode(mode);
    this.container.toggleClass("pdfhl-rect-mode", mode === "rect");
    this.container.toggleClass("pdfhl-text-mode", mode === "text");
    // 离开对应模式时收掉残留的浮动工具栏 / 拖拽框
    if (mode !== "text") this.hideToolbar();
    if (mode !== "rect") this.rectCapture?.cancelDrag();
  }

  applyStyle(): void {
    if (this.destroyed) return;
    this.renderer.setStyle(this.plugin.getColorHex(), this.plugin.settings.opacity);
  }

  // -------------------------------------------------------------------------
  // 选区 → 工具栏 → 复制
  // -------------------------------------------------------------------------

  private showToolbar(anchor: { left: number; top: number; right: number; bottom: number }): void {
    if (this.destroyed) return;
    this.ensureToolbar().showAt(anchor);
  }

  private hideToolbar(): void {
    this.pending = null;
    this.toolbar?.hide();
  }

  private ensureToolbar(): FloatToolbar {
    if (!this.toolbar) {
      this.toolbar = new FloatToolbar(this.container.ownerDocument, {
        onCopyReference: () => void this.copyPending("reference"),
        onCopyLink: () => void this.copyPending("link"),
        onCancel: () => this.hideToolbar(),
      });
    }
    return this.toolbar;
  }

  /** 复制当前选区的链接（format="reference" 时额外拼成「引用行 + 链接」的块） */
  private async copyPending(format: "link" | "reference"): Promise<void> {
    const pending = this.pending;
    if (!pending) return;
    const file = this.getPdfFile();
    if (!file) {
      new Notice("未能识别当前 PDF 文件，链接复制失败");
      return;
    }

    // 别名跟原生 PDF 引用一致：「文件名.pdf, 3 页」
    const alias = buildLinkAlias(file.name, pending.page);
    const link = createPdfLink(
      this.plugin.app,
      file,
      this.plugin.getSourcePath(),
      pending.page,
      pending.kind,
      pending.rect,
      alias,
    );
    const payload =
      format === "reference"
        ? buildReferenceBlock(link, pending.kind, pending.kind === "text" ? pending.alias : null)
        : link;

    const copied = await copyTextToClipboard(payload);
    if (copied) {
      new Notice(
        format === "reference" ? "已复制引用块，粘贴到笔记即可" : "已复制 PDF 高亮链接，粘贴到笔记即可",
      );
      this.hideToolbar();
    } else {
      new Notice("复制失败，请检查剪贴板权限");
    }
  }

  // -------------------------------------------------------------------------
  // 索引 / 渲染
  // -------------------------------------------------------------------------

  /** 组件是否仍然可用（叶子关闭/视图卸载后 pdfViewer 会变成 null） */
  isAlive(): boolean {
    return !this.destroyed && isViewerAlive(this.bv);
  }

  /** 绑定的滚动容器是否还在文档里（窗口迁移后 Obsidian 会重建 DOM） */
  isContainerConnected(): boolean {
    return this.container.isConnected;
  }

  /**
   * 叶子没变但文件可能换了（同一标签页打开另一个 PDF）：
   * 路径变化时重建索引，否则什么都不做。
   */
  syncFile(): void {
    if (!this.isAlive()) return;
    const path = this.getPdfFile()?.path ?? null;
    if (path === this.lastFilePath) return;
    this.refresh();
  }

  /** 立即重建索引并重绘（面板也会刷新）；索引是异步的，用序号丢弃过期结果 */
  refresh(): void {
    if (!this.isAlive()) return;
    const file = this.getPdfFile();
    this.lastFilePath = file?.path ?? null;
    if (!file) {
      this.refreshToken += 1;
      this.entries = [];
      this.renderer.render([]);
      return;
    }

    const token = (this.refreshToken += 1);
    void buildHighlightIndex(this.plugin.app, file)
      .then((entries) => {
        if (this.destroyed || token !== this.refreshToken) return;
        this.entries = entries;
        this.renderer.render(entries);
        this.plugin.notifyDataChanged();
      })
      .catch((error: unknown) => {
        console.warn("[pdfhl] 构建高亮索引失败", error);
      });
  }

  /** 去抖刷新（metadataCache / vault 变更时用） */
  scheduleRefresh(delayMs = 60): void {
    if (!this.isAlive()) return;
    if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = null;
      this.refresh();
    }, delayMs);
  }

  getEntries(): HighlightEntry[] {
    return this.entries;
  }

  getPdfFile(): TFile | null {
    const view = this.leaf.view as unknown as { file?: TFile | null };
    const file = this.bv.file ?? view.file ?? null;
    if (!file || typeof file !== "object") return null;
    return file.extension === "pdf" ? file : null;
  }

  /** 跳转到条目所在页并闪烁（渲染未完成时会在 pagerendered 后重试） */
  goToEntry(entry: HighlightEntry): void {
    if (!this.isAlive()) return;
    const app = this.bv.pdfViewer;
    const viewer = app?.pdfViewer;
    if (!viewer) return;
    const pagesCount = viewer.pagesCount ?? app?.pagesCount ?? 0;
    if (pagesCount > 0 && entry.page > pagesCount) return;
    try {
      viewer.currentPageNumber = entry.page;
    } catch (error) {
      console.warn("[pdfhl] 跳转页码失败", error);
      return;
    }
    this.pendingFlashId = entry.id;
    this.flashAttempts = 0;
    this.tryFlash();
  }

  private tryFlash(): void {
    if (!this.pendingFlashId) return;
    if (this.renderer.flash(this.pendingFlashId)) {
      this.pendingFlashId = null;
      return;
    }
    if (this.flashAttempts >= 20) {
      this.pendingFlashId = null;
      return;
    }
    this.flashAttempts += 1;
    if (this.flashTimer !== null) window.clearTimeout(this.flashTimer);
    this.flashTimer = window.setTimeout(() => {
      this.flashTimer = null;
      this.tryFlash();
    }, 80);
  }

  // -------------------------------------------------------------------------
  // 销毁
  // -------------------------------------------------------------------------

  /**
   * 销毁绑定。
   * 关键：销毁可能发生在视图已经 unload 之后（pdfViewer 已置 null、DOM 已清空），
   * 因此每一步都单独 try/catch，任何一项失败都不能打断后续清理。
   */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;

    if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
    if (this.flashTimer !== null) window.clearTimeout(this.flashTimer);
    this.refreshTimer = null;
    this.flashTimer = null;

    const safe = (label: string, action: () => void) => {
      try {
        action();
      } catch (error) {
        console.debug(`[pdfhl] 清理「${label}」时视图已销毁，已忽略`, error);
      }
    };

    safe("文字选区", () => this.selectionCapture?.stop());
    safe("框选捕获", () => this.rectCapture?.stop());
    this.selectionCapture = null;
    this.rectCapture = null;

    safe("滚动监听", () => {
      if (this.scrollHandler) this.container.removeEventListener("scroll", this.scrollHandler);
    });
    this.scrollHandler = null;

    safe("事件订阅", () => {
      if (!this.bus) return;
      for (const { event, handler } of this.busHandlers) {
        try {
          this.bus.off(event, handler);
        } catch {
          // 视图可能已关闭，忽略
        }
      }
    });
    this.busHandlers = [];
    this.bus = null;

    safe("快捷键", () => {
      if (this.scopeRef && this.scopeHandler) this.scopeRef.unregister(this.scopeHandler);
    });
    this.scopeRef = null;
    this.scopeHandler = null;

    safe("模式按钮", () => this.modeButtons?.destroy());
    this.modeButtons = null;
    safe("浮动工具栏", () => this.toolbar?.destroy());
    this.toolbar = null;
    safe("高亮层", () => this.renderer.destroy());
    safe("容器样式", () => this.container.removeClass("pdfhl-rect-mode"));
    safe("容器样式", () => this.container.removeClass("pdfhl-text-mode"));
    this.pending = null;
    this.entries = [];
    this.lastFilePath = null;
  }
}
