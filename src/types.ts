import type { TFile } from "obsidian";

/**
 * 高亮模式（交互模式的一种）：
 * - text：文字选区，链接参数为 selection=x1,y1,x2,y2
 * - rect：框选区域，链接参数为 rect=x,y,w,h
 */
export type HighlightMode = "text" | "rect";

/**
 * 交互模式：
 * - none：不干预鼠标，PDF 就是正常浏览/选择
 * - text / rect：插件接管对应的取链接操作
 */
export type ActiveMode = "none" | HighlightMode;

/** 归一化矩形：相对页面内容盒的 0–1 比例坐标（不随缩放变化） */
export interface NormRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 从链接 subpath 解析出的高亮信息 */
export interface ParsedHighlight {
  page: number;
  kind: HighlightMode;
  rect: NormRect;
}

/** 面板与渲染层共用的一条高亮记录 */
export interface HighlightEntry {
  /** 稳定标识：页码 + 类型 + 坐标 */
  id: string;
  file: TFile;
  page: number;
  kind: HighlightMode;
  rect: NormRect;
  /** 链接别名（内容片段） */
  text: string;
  /** 来源笔记路径 */
  sourcePath: string;
  /** 链接在来源笔记里的行号（0 基），用于「跳转到笔记」定位 */
  line: number;
  /** 反向链接的原始链接文本 */
  rawLink: string;
}

/** 高亮颜色（P2 设置项） */
export type HighlightColor = "yellow" | "green" | "blue" | "pink";

/** 插件设置 */
export interface PdfHighlightSettings {
  /** 设置数据结构版本（用于旧数据迁移） */
  schemaVersion: number;
  /** 启动时的交互模式（默认无模式，不干预鼠标） */
  defaultMode: ActiveMode;
  color: HighlightColor;
  opacity: number;
}

// ---------------------------------------------------------------------------
// 以下为 Obsidian 内置 PDF 组件（非公开 API）的最小类型声明，仅用于类型提示。
// 这些结构来自 Obsidian 1.15.0 的 app.js，运行时全部通过特征探测访问。
// ---------------------------------------------------------------------------

/** pdf.js 的页面视图（PDFPageView） */
export interface PdfPageViewLike {
  div: HTMLElement;
  canvas?: HTMLElement;
  textLayer?: unknown;
}

/** pdf.js 的 PDFViewer */
export interface PdfViewerLike {
  currentPageNumber: number;
  pagesCount?: number;
  getPageView(index: number): PdfPageViewLike | undefined;
}

/** pdf.js 的 PDFViewerApplication（Obsidian 版） */
export interface PdfViewerAppLike {
  pdfViewer?: PdfViewerLike;
  eventBus?: PdfEventBusLike;
  pagesCount?: number;
  subpath?: string | null;
  subpathHighlight?: { type?: string; page?: number; range?: number[][] } | null;
  applySubpath?: (dest: string) => void;
  dom?: { viewerContainerEl?: HTMLElement };
}

/** pdf.js 的 EventBus（只用到 on/off） */
export interface PdfEventBusLike {
  on(event: string, listener: (payload?: { pageNumber?: number; source?: unknown }) => void): void;
  off(event: string, listener: (payload?: { pageNumber?: number; source?: unknown }) => void): void;
}

/** Obsidian PDF 工具栏 */
export interface PdfToolbarLike {
  toolbarEl?: HTMLElement;
  toolbarLeftEl?: HTMLElement;
  toolbarRightEl?: HTMLElement;
}

/**
 * Obsidian PDF 视图内部的 BV 组件（app.js 中的混淆类，经 1.15.0 实测）。
 * 所有成员都做了存在性检查，缺失时插件降级而不是抛错。
 */
export interface BvLike {
  containerEl: HTMLElement;
  /** 视图卸载（BV.unload）后会被置为 null，所有访问都必须判空 */
  pdfViewer: PdfViewerAppLike | null;
  toolbar?: PdfToolbarLike;
  /** 注意：Obsidian 1.15 的 BV 没有 eventBus 属性，事件总线在 pdfViewer.eventBus 上 */
  eventBus?: PdfEventBusLike;
  file?: TFile;
  loaded?: boolean;
  unloaded?: boolean;
  /** 原生解析出的高亮状态（插件会置空以抑制退化高亮） */
  subpathHighlight?: { type?: string; page?: number; range?: number[][] } | null;
  getPage?(page: number): PdfPageViewLike | undefined;
  clearTextHighlight?(): void;
  highlightText?(page: number, range: number[][]): void;
  applySubpath?(subpath: string): void;
  getMarkdownLink?(subpath: string, alias?: string, embed?: boolean): string;
  /** BV 自身的事件转发（内部走 pdfViewer.eventBus._on/_off） */
  on?(event: string, listener: (payload?: unknown) => void): void;
  off?(event: string, listener: (payload?: unknown) => void): void;
}
