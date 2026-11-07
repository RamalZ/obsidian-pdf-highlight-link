import type { WorkspaceLeaf } from "obsidian";
import type PdfHighlightLinkPlugin from "../main.ts";
import type { BvLike } from "../types.ts";
import { getLoadedViewerComponent, PDF_VIEW_TYPE } from "./pdf-viewer-api.ts";
import { ViewerBinding } from "./viewer-binding.ts";

/** 组件尚未就绪时的重试间隔与次数上限 */
const RETRY_DELAY_MS = 300;
const MAX_RETRIES = 20;

/**
 * 管理所有 PDF 叶子的 ViewerBinding：
 * - 监听工作区布局变化，为新的 PDF 叶子建立绑定
 * - 叶子关闭/组件重建时销毁旧绑定
 * - 对外提供「当前 PDF」的绑定，供面板与设置使用
 */
export class ViewerManager {
  private plugin: PdfHighlightLinkPlugin;
  private bindings = new Map<WorkspaceLeaf, ViewerBinding>();
  private retryTimers = new Map<WorkspaceLeaf, number>();
  private retryCounts = new Map<WorkspaceLeaf, number>();
  private lastActiveLeaf: WorkspaceLeaf | null = null;
  /** 最近一次激活的 PDF 叶子：面板点「跳转到笔记」后激活叶子会变成笔记，仍需记住 PDF */
  private lastPdfLeaf: WorkspaceLeaf | null = null;
  /** 插件卸载后置 true，阻止任何延迟回调再碰内部组件 */
  private disposed = false;

  constructor(plugin: PdfHighlightLinkPlugin) {
    this.plugin = plugin;
  }

  /** 插件 onload 时调用：注册工作区事件并做首次扫描 */
  register(): void {
    const workspace = this.plugin.app.workspace;
    this.plugin.registerEvent(
      workspace.on("layout-change", () => this.scheduleRescan(40)),
    );
    this.plugin.registerEvent(
      workspace.on("active-leaf-change", (leaf) => {
        this.lastActiveLeaf = leaf;
        this.rescan();
        // 绑定可能在这一轮才创建，扫描后再确认
        if (leaf && this.bindings.has(leaf)) this.lastPdfLeaf = leaf;
      }),
    );
    this.plugin.registerEvent(
      workspace.on("file-open", () => this.scheduleRescan(40)),
    );
    this.rescan();
  }

  private scheduleRescan(delayMs: number): void {
    window.setTimeout(() => {
      if (!this.disposed) this.rescan();
    }, delayMs);
  }

  /** 扫描所有 PDF 叶子，补齐/清理绑定 */
  rescan(): void {
    if (this.disposed) return;
    const leaves = this.plugin.app.workspace.getLeavesOfType(PDF_VIEW_TYPE);
    const alive = new Set<WorkspaceLeaf>();

    for (const leaf of leaves) {
      alive.add(leaf);
      try {
        const bv = getLoadedViewerComponent(leaf);
        const existing = this.bindings.get(leaf);

        if (!bv) {
          // 组件还没创建好（正在加载），稍后重试；旧绑定若已随视图卸载则先清理
          if (existing && !existing.isAlive()) {
            this.destroyBinding(leaf, existing);
          } else if (!existing) {
            this.scheduleRetry(leaf);
          }
          continue;
        }

        if (existing && existing.bv === bv) {
          this.clearRetry(leaf);
          // 窗口迁移/内部 DOM 重建后容器会失效，需要重新绑定
          if (!existing.isContainerConnected()) {
            this.destroyBinding(leaf, existing);
            this.bind(leaf, bv);
            continue;
          }
          // 同一叶子换了 PDF 文件时重建索引
          existing.syncFile();
          continue;
        }

        if (existing) this.destroyBinding(leaf, existing);
        this.bind(leaf, bv);
      } catch (error) {
        console.error("[pdfhl] 扫描 PDF 视图失败（已跳过该叶子）", error);
      }
    }

    for (const [leaf, binding] of Array.from(this.bindings.entries())) {
      if (alive.has(leaf)) continue;
      this.destroyBinding(leaf, binding);
      this.clearRetry(leaf);
    }
  }

  /** 销毁单个绑定并容忍「对象已被视图销毁」的情况 */
  private destroyBinding(leaf: WorkspaceLeaf, binding: ViewerBinding): void {
    try {
      binding.destroy();
    } catch (error) {
      console.debug("[pdfhl] 销毁旧绑定失败（已忽略，视图可能已卸载）", error);
    }
    this.bindings.delete(leaf);
  }

  private bind(leaf: WorkspaceLeaf, bv: BvLike): void {
    try {
      const binding = new ViewerBinding(this.plugin, leaf, bv);
      this.bindings.set(leaf, binding);
      this.clearRetry(leaf);
    } catch (error) {
      console.error("[pdfhl] 绑定 PDF 视图失败", error);
    }
  }

  private scheduleRetry(leaf: WorkspaceLeaf): void {
    if (this.disposed) return;
    if (this.retryTimers.has(leaf)) return;
    const count = this.retryCounts.get(leaf) ?? 0;
    if (count >= MAX_RETRIES) return;
    this.retryCounts.set(leaf, count + 1);
    const timer = window.setTimeout(() => {
      this.retryTimers.delete(leaf);
      this.rescan();
    }, RETRY_DELAY_MS);
    this.retryTimers.set(leaf, timer);
  }

  private clearRetry(leaf: WorkspaceLeaf): void {
    const timer = this.retryTimers.get(leaf);
    if (timer !== undefined) window.clearTimeout(timer);
    this.retryTimers.delete(leaf);
    this.retryCounts.delete(leaf);
  }

  // -------------------------------------------------------------------------
  // 查询
  // -------------------------------------------------------------------------

  getBindings(): ViewerBinding[] {
    return Array.from(this.bindings.values());
  }

  getBindingForPath(path: string): ViewerBinding | null {
    for (const binding of this.bindings.values()) {
      if (binding.getPdfFile()?.path === path) return binding;
    }
    return null;
  }

  /** 当前激活的 PDF 绑定；不是 PDF 时回退到最近激活的 PDF */
  getActiveBinding(): ViewerBinding | null {
    const candidates: Array<WorkspaceLeaf | null> = [
      this.lastActiveLeaf,
      this.lastPdfLeaf,
      this.plugin.app.workspace.activeLeaf,
    ];
    for (const leaf of candidates) {
      if (!leaf) continue;
      const binding = this.bindings.get(leaf);
      if (binding && binding.isAlive()) return binding;
    }
    for (const binding of this.bindings.values()) {
      if (binding.getPdfFile()) return binding;
    }
    return null;
  }

  getActivePdfPath(): string | null {
    return this.getActiveBinding()?.getPdfFile()?.path ?? null;
  }

  // -------------------------------------------------------------------------
  // 批量操作
  // -------------------------------------------------------------------------

  refreshAll(): void {
    for (const binding of this.bindings.values()) {
      try {
        binding.refresh();
      } catch (error) {
        console.debug("[pdfhl] 刷新绑定失败（已忽略）", error);
      }
    }
  }

  applyStyleAll(): void {
    for (const binding of this.bindings.values()) {
      try {
        binding.applyStyle();
      } catch (error) {
        console.debug("[pdfhl] 应用样式失败（已忽略）", error);
      }
    }
  }

  applyModeAll(): void {
    for (const binding of this.bindings.values()) {
      try {
        binding.applyModeVisual();
      } catch (error) {
        console.debug("[pdfhl] 应用模式失败（已忽略）", error);
      }
    }
  }

  destroyAll(): void {
    this.disposed = true;
    for (const timer of this.retryTimers.values()) window.clearTimeout(timer);
    this.retryTimers.clear();
    this.retryCounts.clear();
    for (const [leaf, binding] of Array.from(this.bindings.entries())) {
      this.destroyBinding(leaf, binding);
    }
    this.bindings.clear();
    this.lastActiveLeaf = null;
    this.lastPdfLeaf = null;
  }
}
