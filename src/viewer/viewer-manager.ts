import type { WorkspaceLeaf } from "obsidian";
import type PdfHighlightLinkPlugin from "../main.ts";
import type { BvLike, PdfEmbedComponentLike } from "../types.ts";
import { getLoadedViewerComponent, isViewerAlive, PDF_VIEW_TYPE } from "./pdf-viewer-api.ts";
import { ViewerBinding } from "./viewer-binding.ts";
import { EmbedViewerHost, LeafViewerHost } from "./viewer-host.ts";

/** 组件尚未就绪时的重试间隔与次数上限 */
const RETRY_DELAY_MS = 300;
const MAX_RETRIES = 20;
/** 悬停预览里的 PDF 是临时的，不纳入面板/绑定 */
const HOVER_POPOVER_SELECTOR = ".hover-popover";

interface AddChildPrototype {
  addChild?: (...args: unknown[]) => unknown;
  [key: string]: unknown;
}

interface ComponentNode {
  _children?: unknown;
}

interface EmbedActivationHandlers {
  activate: () => void;
}

/** 判断一个组件是不是 Obsidian 的 PDF 内嵌组件（内部 du）。 */
function isPdfEmbedComponent(value: unknown): value is PdfEmbedComponentLike {
  if (!value || typeof value !== "object") return false;
  const component = value as PdfEmbedComponentLike;
  const container = component.containerEl;
  if (!container || typeof container.closest !== "function") return false;
  if (typeof container.classList?.contains !== "function") return false;
  if (!container.classList.contains("pdf-embed")) return false;
  if (!component.file || component.file.extension !== "pdf") return false;
  return Boolean(component.viewer && typeof component.viewer.then === "function");
}

/**
 * 管理所有 PDF 绑定：
 * - 普通 PDF 叶子（WorkspaceLeaf）
 * - 笔记/画布里的内嵌 PDF（PdfEmbedComponentLike）
 *
 * 内嵌 PDF 的发现分两路：包装 Component.addChild 捕获新组件，同时扫描已有组件树。
 */
export class ViewerManager {
  private plugin: PdfHighlightLinkPlugin;
  private bindings = new Map<WorkspaceLeaf, ViewerBinding>();
  private retryTimers = new Map<WorkspaceLeaf, number>();
  private retryCounts = new Map<WorkspaceLeaf, number>();

  private embedComponents = new Map<HTMLElement, PdfEmbedComponentLike>();
  private embedBindings = new Map<HTMLElement, ViewerBinding>();
  private embedRetryTimers = new Map<HTMLElement, number>();
  private embedRetryCounts = new Map<HTMLElement, number>();
  private embedActivationHandlers = new Map<HTMLElement, EmbedActivationHandlers>();

  private lastActiveLeaf: WorkspaceLeaf | null = null;
  /** 最近一次激活的 PDF 叶子：面板点「跳转到笔记」后激活叶子会变成笔记，仍需记住 PDF */
  private lastPdfLeaf: WorkspaceLeaf | null = null;
  /** 最近一次交互的内嵌 PDF */
  private lastActiveEmbed: ViewerBinding | null = null;
  private restoreAddChildHook: (() => void) | null = null;
  /** 插件卸载后置 true，阻止任何延迟回调再碰内部组件 */
  private disposed = false;

  constructor(plugin: PdfHighlightLinkPlugin) {
    this.plugin = plugin;
  }

  /** 插件 onload 时调用：安装内嵌捕获钩子、注册工作区事件并做首次扫描 */
  register(): void {
    this.installAddChildHook();
    this.plugin.register(() => this.restoreAddChildHook?.());

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
        this.plugin.notifyDataChanged();
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

  /** 扫描所有 PDF 叶子与内嵌组件，补齐/清理绑定 */
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

    this.rescanEmbeds();
  }

  /** 扫描已经存在/新增的内嵌 PDF（addChild 钩子可能漏掉启动前创建的实例） */
  private rescanEmbeds(): void {
    if (this.disposed) return;
    const found = new Set<HTMLElement>();

    try {
      this.plugin.app.workspace.iterateAllLeaves((leaf) => {
        this.collectEmbedComponents(leaf.view, found, new Set<object>());
      });
    } catch (error) {
      console.debug("[pdfhl] 扫描内嵌 PDF 组件树失败", error);
    }

    for (const [container, binding] of Array.from(this.embedBindings.entries())) {
      if (!container.isConnected) {
        this.removeEmbed(container, binding);
        continue;
      }
      if (!binding.isAlive()) {
        this.removeEmbed(container, binding);
      }
    }

    for (const container of Array.from(this.embedComponents.keys())) {
      if (!container.isConnected) {
        this.removeEmbed(container);
        continue;
      }
      if (this.embedBindings.has(container)) continue;
      const embed = this.embedComponents.get(container);
      const child = embed?.viewer?.child ?? null;
      if (embed && child && isViewerAlive(child)) {
        this.bindEmbed(container, embed, child);
      } else {
        this.scheduleEmbedRetry(container);
      }
    }

    // 组件树里发现但还没登记过的容器，captureEmbedComponent 已在 collect 内处理；
    // 这里仅确保 found 里的容器没有漏绑定
    for (const container of found) {
      const embed = this.embedComponents.get(container);
      const child = embed?.viewer?.child ?? null;
      if (!embed || !child || !isViewerAlive(child)) continue;
      if (!this.embedBindings.has(container)) this.bindEmbed(container, embed, child);
    }
  }

  /** 递归收集组件树里的 PDF 内嵌组件 */
  private collectEmbedComponents(root: unknown, found: Set<HTMLElement>, visited: Set<object>): void {
    if (!root || typeof root !== "object") return;
    if (visited.has(root)) return;
    visited.add(root);

    if (isPdfEmbedComponent(root)) {
      this.captureEmbedComponent(root);
      found.add(root.containerEl);
    }

    const children = (root as ComponentNode)._children;
    if (!Array.isArray(children)) return;
    for (const child of children) this.collectEmbedComponents(child, found, visited);
  }

  /**
   * 包装 Component.prototype.addChild，捕获阅读视图/实时预览里新创建的 PDF 内嵌。
   * 不依赖具体类名，只按组件形状识别，兼容 Obsidian 内部重命名。
   */
  private installAddChildHook(): void {
    if (this.restoreAddChildHook) return;
    try {
      // 必须找到「自己拥有」addChild 的原型（Component.prototype）。
      // 只看 typeof 会停在插件子类原型上（它只是继承了 addChild），
      // 那样只能捕获插件自己的组件，捕获不到 Obsidian 创建的内嵌 PDF。
      let proto = Object.getPrototypeOf(this.plugin) as AddChildPrototype | null;
      while (proto && !Object.prototype.hasOwnProperty.call(proto, "addChild")) {
        proto = Object.getPrototypeOf(proto) as AddChildPrototype | null;
      }
      if (!proto || typeof proto.addChild !== "function") return;
      if (proto.__pdfhlAddChildPatched) return;

      const original = proto.addChild;
      const manager = this;
      proto.addChild = function patchedAddChild(this: unknown, ...args: unknown[]): unknown {
        const result = original.apply(this, args);
        try {
          manager.captureEmbedComponent(args[0]);
        } catch (error) {
          console.debug("[pdfhl] 捕获内嵌 PDF 组件失败（已忽略）", error);
        }
        return result;
      };
      proto.__pdfhlAddChildPatched = true;
      this.restoreAddChildHook = () => {
        if (proto.__pdfhlAddChildPatched) {
          proto.addChild = original;
          delete proto.__pdfhlAddChildPatched;
        }
        this.restoreAddChildHook = null;
      };
    } catch (error) {
      console.debug("[pdfhl] 安装内嵌 PDF 捕获钩子失败（改用扫描）", error);
    }
  }

  /** 登记一个内嵌组件，并在其 viewer 就绪后建立绑定 */
  private captureEmbedComponent(value: unknown): void {
    if (this.disposed || !isPdfEmbedComponent(value)) return;
    const embed = value;
    const container = embed.containerEl;
    if (container.closest(HOVER_POPOVER_SELECTOR)) return;

    const known = this.embedComponents.get(container);
    const existing = this.embedBindings.get(container);
    if (existing) {
      // 同一个容器可能被 Obsidian 重新渲染成新的内嵌组件（实时预览/重绘）。
      // 旧绑定还指向旧 BV 时必须先拆掉，否则新组件永远拿不到工具栏与高亮。
      const currentBv = embed.viewer?.child ?? null;
      if (existing.bv !== currentBv) this.removeEmbed(container, existing);
    }

    this.embedComponents.set(container, embed);
    // viewer 的 then 可能排队等待加载；重复登记会积压多个回调，已知同一组件时跳过。
    // 若绑定被移除但组件还在，下一次 rescanEmbeds 会用 viewer.child 重新绑定。
    if (known === embed) return;
    this.registerEmbedViewer(container, embed);
  }

  private registerEmbedViewer(container: HTMLElement, embed: PdfEmbedComponentLike): void {
    const viewer = embed.viewer;
    if (!viewer || typeof viewer.then !== "function") {
      this.scheduleEmbedRetry(container);
      return;
    }
    try {
      viewer.then((bv) => {
        if (this.disposed) return;
        if (!container.isConnected) {
          this.removeEmbed(container);
          return;
        }
        if (!isViewerAlive(bv)) {
          this.scheduleEmbedRetry(container);
          return;
        }
        this.bindEmbed(container, embed, bv);
      });
    } catch (error) {
      console.warn("[pdfhl] 等待内嵌 PDF 加载失败", error);
      this.scheduleEmbedRetry(container);
    }
  }

  private bindEmbed(container: HTMLElement, embed: PdfEmbedComponentLike, bv: BvLike): void {
    if (this.disposed) return;
    if (!container.isConnected) {
      this.removeEmbed(container);
      return;
    }

    const existing = this.embedBindings.get(container);
    if (existing) {
      if (existing.bv === bv) {
        this.clearEmbedRetry(container);
        if (!existing.isContainerConnected()) {
          this.removeEmbed(container, existing);
        } else {
          existing.syncFile();
          return;
        }
      } else {
        this.removeEmbed(container, existing);
      }
    }
    if (!container.isConnected) return;
    if (!isViewerAlive(bv)) {
      this.scheduleEmbedRetry(container);
      return;
    }

    try {
      const host = new EmbedViewerHost(this.plugin.app, embed, bv);
      const binding = new ViewerBinding(this.plugin, host, bv);
      this.embedBindings.set(container, binding);
      this.embedComponents.set(container, embed);
      this.lastActiveEmbed = binding;
      this.clearEmbedRetry(container);
      this.addEmbedActivation(container, binding);
      this.plugin.notifyDataChanged();
    } catch (error) {
      console.error("[pdfhl] 绑定内嵌 PDF 失败", error);
      this.scheduleEmbedRetry(container);
    }
  }

  private addEmbedActivation(container: HTMLElement, binding: ViewerBinding): void {
    if (this.embedActivationHandlers.has(container)) return;
    const activate = () => {
      if (this.disposed || this.lastActiveEmbed === binding) return;
      this.lastActiveEmbed = binding;
      this.plugin.notifyDataChanged();
    };
    container.addEventListener("pointerdown", activate, true);
    container.addEventListener("focusin", activate, true);
    this.embedActivationHandlers.set(container, { activate });
  }

  private removeEmbedActivation(container: HTMLElement): void {
    const handlers = this.embedActivationHandlers.get(container);
    if (!handlers) return;
    container.removeEventListener("pointerdown", handlers.activate, true);
    container.removeEventListener("focusin", handlers.activate, true);
    this.embedActivationHandlers.delete(container);
  }

  /** 销毁单个内嵌绑定；组件本身可能已被 Obsidian 移除 */
  private removeEmbed(container: HTMLElement, binding?: ViewerBinding): void {
    const current = binding ?? this.embedBindings.get(container);
    if (current) {
      try {
        current.destroy();
      } catch (error) {
        console.debug("[pdfhl] 销毁内嵌 PDF 绑定时视图已卸载，已忽略", error);
      }
      this.embedBindings.delete(container);
      if (this.lastActiveEmbed === current) this.lastActiveEmbed = null;
    }
    this.removeEmbedActivation(container);
    this.embedComponents.delete(container);
    this.clearEmbedRetry(container);
  }

  private scheduleEmbedRetry(container: HTMLElement): void {
    if (this.disposed || !container.isConnected) return;
    if (this.embedRetryTimers.has(container)) return;
    const count = this.embedRetryCounts.get(container) ?? 0;
    if (count >= MAX_RETRIES) return;
    this.embedRetryCounts.set(container, count + 1);
    const timer = window.setTimeout(() => {
      this.embedRetryTimers.delete(container);
      this.rescanEmbeds();
    }, RETRY_DELAY_MS);
    this.embedRetryTimers.set(container, timer);
  }

  private clearEmbedRetry(container: HTMLElement): void {
    const timer = this.embedRetryTimers.get(container);
    if (timer !== undefined) window.clearTimeout(timer);
    this.embedRetryTimers.delete(container);
    this.embedRetryCounts.delete(container);
  }

  /** 销毁单个叶子绑定并容忍「对象已被视图销毁」的情况 */
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
      const binding = new ViewerBinding(this.plugin, new LeafViewerHost(leaf, bv), bv);
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
    return [...this.bindings.values(), ...this.embedBindings.values()];
  }

  getEmbedBindings(): ViewerBinding[] {
    return Array.from(this.embedBindings.values());
  }

  getBindingForPath(path: string): ViewerBinding | null {
    for (const binding of this.getBindings()) {
      if (binding.getPdfFile()?.path === path) return binding;
    }
    return null;
  }

  /** 当前激活的 PDF 绑定；优先当前叶子，其次叶子里的内嵌 PDF，最后回退到最近激活的 PDF */
  getActiveBinding(): ViewerBinding | null {
    const workspace = this.plugin.app.workspace;
    const activeLeaf = workspace.activeLeaf;

    if (activeLeaf) {
      const leafBinding = this.bindings.get(activeLeaf);
      if (leafBinding?.isAlive()) return leafBinding;

      const viewEl = (activeLeaf.view as unknown as { containerEl?: HTMLElement }).containerEl;
      if (viewEl) {
        const candidates = Array.from(this.embedBindings.entries())
          .filter(([container, binding]) => viewEl.contains(container) && binding.isAlive())
          .map(([, binding]) => binding);
        if (this.lastActiveEmbed && candidates.includes(this.lastActiveEmbed)) {
          return this.lastActiveEmbed;
        }
        if (candidates.length > 0) return candidates[0];
      }
    }

    for (const leaf of [this.lastPdfLeaf, this.lastActiveLeaf]) {
      if (!leaf) continue;
      const binding = this.bindings.get(leaf);
      if (binding?.isAlive()) return binding;
    }

    if (this.lastActiveEmbed?.isAlive()) return this.lastActiveEmbed;

    for (const binding of this.getBindings()) {
      if (binding.isAlive() && binding.getPdfFile()) return binding;
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
    for (const binding of this.getBindings()) {
      try {
        binding.refresh();
      } catch (error) {
        console.debug("[pdfhl] 刷新绑定失败（已忽略）", error);
      }
    }
  }

  applyStyleAll(): void {
    for (const binding of this.getBindings()) {
      try {
        binding.applyStyle();
      } catch (error) {
        console.debug("[pdfhl] 应用样式失败（已忽略）", error);
      }
    }
  }

  applyModeAll(): void {
    for (const binding of this.getBindings()) {
      try {
        binding.applyModeVisual();
      } catch (error) {
        console.debug("[pdfhl] 应用模式失败（已忽略）", error);
      }
    }
  }

  destroyAll(): void {
    this.disposed = true;
    this.restoreAddChildHook?.();

    for (const timer of this.retryTimers.values()) window.clearTimeout(timer);
    for (const timer of this.embedRetryTimers.values()) window.clearTimeout(timer);
    this.retryTimers.clear();
    this.retryCounts.clear();
    this.embedRetryTimers.clear();
    this.embedRetryCounts.clear();

    for (const [leaf, binding] of Array.from(this.bindings.entries())) {
      this.destroyBinding(leaf, binding);
    }
    for (const [container, binding] of Array.from(this.embedBindings.entries())) {
      this.removeEmbed(container, binding);
    }
    for (const container of Array.from(this.embedComponents.keys())) {
      this.removeEmbed(container);
    }
    for (const container of Array.from(this.embedActivationHandlers.keys())) {
      this.removeEmbedActivation(container);
    }

    this.bindings.clear();
    this.embedBindings.clear();
    this.embedComponents.clear();
    this.embedActivationHandlers.clear();
    this.lastActiveLeaf = null;
    this.lastPdfLeaf = null;
    this.lastActiveEmbed = null;
  }
}
