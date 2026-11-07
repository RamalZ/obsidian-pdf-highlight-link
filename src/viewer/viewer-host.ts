import type { App, Scope, TFile, WorkspaceLeaf } from "obsidian";
import type { BvLike, PdfEmbedComponentLike } from "../types.ts";

export type ViewerHostKind = "leaf" | "embed";

export interface ViewerHostInfo {
  kind: ViewerHostKind;
  leaf: WorkspaceLeaf | null;
  sourcePath: string;
  containerConnected: boolean;
  canvas: boolean;
}

/**
 * ViewerBinding 的宿主抽象：
 * - leaf：普通 PDF 标签页
 * - embed：笔记/画布里通过 ![[file.pdf]] 内嵌的 PDF
 *
 * 绑定逻辑只依赖这个接口，不再直接假设宿主一定是 WorkspaceLeaf。
 */
export interface ViewerHost {
  readonly kind: ViewerHostKind;
  readonly leaf: WorkspaceLeaf | null;
  readonly containerEl: HTMLElement;
  getScope(): Scope | null;
  getFallbackFile(): TFile | null;
  getSourcePath(): string;
  /** 是否使用插件自绘的 overlay 控件（普通内嵌 PDF 的原生工具栏被 CSS 隐藏） */
  useOverlayControls(): boolean;
  getOverlayParent(): HTMLElement;
  isConnected(): boolean;
  getInfo(): ViewerHostInfo;
}

function isPdfFile(file: TFile | null | undefined): file is TFile {
  return Boolean(file && typeof file === "object" && file.extension === "pdf");
}

/** 普通 PDF 标签页：来源路径保持空字符串，与原生复制 PDF 链接一致。 */
export class LeafViewerHost implements ViewerHost {
  readonly kind = "leaf" as const;
  readonly leaf: WorkspaceLeaf;
  readonly containerEl: HTMLElement;

  constructor(leaf: WorkspaceLeaf, bv: BvLike) {
    this.leaf = leaf;
    this.containerEl = bv.containerEl;
  }

  getScope(): Scope | null {
    const view = this.leaf.view as unknown as { scope?: Scope };
    return view.scope ?? null;
  }

  getFallbackFile(): TFile | null {
    const view = this.leaf.view as unknown as { file?: TFile | null };
    return isPdfFile(view.file) ? view.file : null;
  }

  getSourcePath(): string {
    return "";
  }

  useOverlayControls(): boolean {
    return false;
  }

  getOverlayParent(): HTMLElement {
    return this.containerEl;
  }

  isConnected(): boolean {
    return this.containerEl.isConnected;
  }

  getInfo(): ViewerHostInfo {
    return {
      kind: this.kind,
      leaf: this.leaf,
      sourcePath: "",
      containerConnected: this.isConnected(),
      canvas: false,
    };
  }
}

/**
 * 笔记内嵌 PDF：容器就是 .internal-embed / .pdf-embed 元素。
 * du 组件不保存 ctx.sourcePath，因此从包含它的 WorkspaceLeaf 反查来源笔记。
 */
export class EmbedViewerHost implements ViewerHost {
  readonly kind = "embed" as const;
  readonly leaf = null;
  readonly containerEl: HTMLElement;

  private app: App;
  private embed: PdfEmbedComponentLike;
  private bv: BvLike;
  private cachedSourcePath: string | null = null;

  constructor(app: App, embed: PdfEmbedComponentLike, bv: BvLike) {
    this.app = app;
    this.embed = embed;
    this.bv = bv;
    this.containerEl = embed.containerEl;
  }

  getScope(): Scope | null {
    return this.bv.scope ?? null;
  }

  getFallbackFile(): TFile | null {
    return isPdfFile(this.embed.file) ? this.embed.file : null;
  }

  getSourcePath(): string {
    if (this.cachedSourcePath === null) this.cachedSourcePath = this.resolveSourcePath();
    return this.cachedSourcePath;
  }

  useOverlayControls(): boolean {
    // 画布与普通笔记内嵌的原生工具栏在屏幕上通常都可见；
    // 普通内嵌仍用 overlay，避免把插件按钮混入原生工具栏，但 overlay 会避让其右侧控件。
    return !this.containerEl.closest(".canvas-node-content");
  }

  getOverlayParent(): HTMLElement {
    return this.containerEl;
  }

  isConnected(): boolean {
    return this.containerEl.isConnected;
  }

  getInfo(): ViewerHostInfo {
    return {
      kind: this.kind,
      leaf: null,
      sourcePath: this.getSourcePath(),
      containerConnected: this.isConnected(),
      canvas: !this.useOverlayControls(),
    };
  }

  private resolveSourcePath(): string {
    let found = "";
    try {
      this.app.workspace.iterateAllLeaves((leaf) => {
        if (found) return;
        const view = leaf.view as unknown as { file?: TFile | null; containerEl?: HTMLElement };
        const viewEl = view.containerEl;
        if (!viewEl || viewEl === this.containerEl) return;
        if (!viewEl.contains(this.containerEl)) return;
        const file = view.file;
        if (file && typeof file.path === "string" && file.path) found = file.path;
      });
    } catch (error) {
      console.debug("[pdfhl] 解析内嵌 PDF 的来源笔记失败", error);
    }
    return found;
  }
}
