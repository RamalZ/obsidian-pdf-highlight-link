import type { WorkspaceLeaf } from "obsidian";
import type { BvLike, PdfEventBusLike } from "../types.ts";

/** Obsidian PDF 视图的 viewType 常量 */
export const PDF_VIEW_TYPE = "pdf";

/** 内部组件就绪的等待上限（毫秒） */
const READY_TIMEOUT_MS = 15_000;

interface PdfViewLike {
  getViewType?: () => string;
  viewer?: unknown;
  file?: unknown;
}

/** 解包 PDF 视图的 thenable viewer 包装器（wI）拿到内部 BV 组件 */
function unwrapViewer(value: unknown): Promise<unknown> {
  return new Promise((resolve) => {
    const thenable = value as { then?: (callback: (child: unknown) => void) => void } | null;
    if (thenable && typeof thenable.then === "function") {
      thenable.then((child) => resolve(child));
      return;
    }
    resolve(value);
  });
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
  let timer: number | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<null>((resolve) => {
        timer = window.setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) window.clearTimeout(timer);
  }
}

/** 校验内部组件是否具备插件依赖的能力（缺任何一项都视为版本不兼容） */
export function isViewerCompatible(bv: BvLike | null | undefined): bv is BvLike {
  return isViewerAlive(bv);
}

/**
 * 组件当前是否「活着」：BV.unload() 会把 pdfViewer 置为 null 并清空 DOM，
 * 此后所有内部访问都会抛 null 异常，所以调用前统一判活。
 */
export function isViewerAlive(bv: BvLike | null | undefined): boolean {
  if (!bv || !bv.containerEl) return false;
  const app = bv.pdfViewer;
  return Boolean(app && app.pdfViewer && typeof app.pdfViewer.getPageView === "function");
}

/**
 * 取某个叶子对应的内部 PDF 组件。
 * 返回 null 的常见原因：叶子不是 PDF、组件尚未创建、或 Obsidian 版本改了内部结构。
 */
export async function resolveViewerComponent(leaf: WorkspaceLeaf, timeoutMs = READY_TIMEOUT_MS): Promise<BvLike | null> {
  const view = leaf.view as unknown as PdfViewLike | undefined;
  if (!view || typeof view.getViewType !== "function" || view.getViewType() !== PDF_VIEW_TYPE) return null;
  if (!view.viewer) return null;

  const unwrapped = await withTimeout(unwrapViewer(view.viewer), timeoutMs);
  if (!unwrapped || typeof unwrapped !== "object") return null;
  const candidate = unwrapped as BvLike;
  return isViewerCompatible(candidate) ? candidate : null;
}

/**
 * 同步取「已经就绪」的内部组件。
 * 事件回调里用它重扫描，避免每次 layout-change 都排队等异步 Promise。
 */
export function getLoadedViewerComponent(leaf: WorkspaceLeaf): BvLike | null {
  const view = leaf.view as unknown as PdfViewLike | undefined;
  if (!view || typeof view.getViewType !== "function" || view.getViewType() !== PDF_VIEW_TYPE) return null;
  const raw = view.viewer;
  if (!raw || typeof raw !== "object") return null;
  const wrapper = raw as { child?: unknown };
  const candidate = (wrapper.child ?? raw) as BvLike;
  if (!candidate || !candidate.containerEl) return null;
  return isViewerCompatible(candidate) ? candidate : null;
}

/** PDF 滚动容器（页面元素的父容器）；视图已卸载时退回到外层容器，保证不抛错 */
export function getViewerContainer(bv: BvLike): HTMLElement {
  const fromDom = bv.pdfViewer?.dom?.viewerContainerEl;
  if (fromDom) return fromDom;
  const found = bv.containerEl?.querySelector<HTMLElement>(".pdf-viewer-container");
  return found ?? bv.containerEl;
}

/** 当前已创建的所有页面元素（视图已卸载时返回空数组） */
export function getPageElements(bv: BvLike): HTMLElement[] {
  try {
    const container = getViewerContainer(bv);
    if (!container) return [];
    return Array.from(container.querySelectorAll<HTMLElement>(".page[data-page-number]"));
  } catch (error) {
    console.debug("[pdfhl] 读取页面元素失败（视图可能已卸载）", error);
    return [];
  }
}

/** 取指定页码的页面元素（优先用内置 getPage，保证拿到的是当前视图实例） */
export function getPageElement(bv: BvLike, page: number): HTMLElement | null {
  if (!isViewerAlive(bv)) return null;
  try {
    const pageView = bv.getPage?.(page);
    if (pageView?.div && pageView.div.isConnected) return pageView.div;
  } catch (error) {
    console.debug("[pdfhl] getPage 失败（视图可能已卸载）", error);
  }
  const container = getViewerContainer(bv);
  return container?.querySelector<HTMLElement>(`.page[data-page-number="${page}"]`) ?? null;
}

/**
 * 事件总线适配器。
 * 实测 Obsidian 1.15 的 BV 没有 eventBus 属性，总线挂在 pdfViewer.eventBus 上；
 * BV 另外提供 on/off 转发方法。这里按优先级返回一个统一的 { on, off } 接口。
 */
export function getEventBus(bv: BvLike): PdfEventBusLike | null {
  const app = bv.pdfViewer;
  const bus = app?.eventBus;
  if (bus && typeof bus.on === "function" && typeof bus.off === "function") {
    return {
      on: (event, listener) => bus.on(event, listener),
      off: (event, listener) => bus.off(event, listener),
    };
  }
  if (typeof bv.on === "function" && typeof bv.off === "function") {
    return {
      on: (event, listener) => bv.on?.(event, listener as (payload?: unknown) => void),
      off: (event, listener) => bv.off?.(event, listener as (payload?: unknown) => void),
    };
  }
  if (bv.eventBus) return bv.eventBus;
  return null;
}

/** 诊断用：把内部组件的可观测结构整理成可直接 console.log 的对象 */
export function describeViewer(bv: BvLike): Record<string, unknown> {
  const app = bv.pdfViewer;
  const proto = Object.getPrototypeOf(bv) as object | null;
  const appProto = app ? (Object.getPrototypeOf(app) as object | null) : null;
  const bus = getEventBus(bv);
  const eventBusSource = app?.eventBus
    ? "pdfViewer.eventBus"
    : typeof bv.on === "function"
      ? "bv.on/off"
      : bv.eventBus
        ? "bv.eventBus"
        : "none";
  return {
    ready: isViewerAlive(bv),
    unloaded: bv.unloaded === true,
    file: bv.file?.path ?? null,
    viewerKeys: Object.keys(bv).sort(),
    viewerProtoKeys: proto ? Object.getOwnPropertyNames(proto).sort() : [],
    pdfViewerKeys: app ? Object.keys(app).sort() : [],
    pdfViewerProtoKeys: appProto ? Object.getOwnPropertyNames(appProto).sort() : [],
    hasEventBus: Boolean(bus),
    eventBusSource,
    pdfViewerReady: Boolean(app?.pdfViewer),
    pagesCount: app?.pdfViewer?.pagesCount ?? app?.pagesCount ?? null,
    domViewerContainer: Boolean(app?.dom?.viewerContainerEl),
    containerConnected: bv.containerEl?.isConnected ?? false,
    containerChildren: bv.containerEl?.childElementCount ?? -1,
    pageElements: getPageElements(bv).length,
  };
}

// ---------------------------------------------------------------------------
// 原生高亮抑制
//
// Obsidian 自带的 subpath 解析器把 selection 当作「字符下标」并用 parseInt 处理。
// 我们的 selection 是浮点比例坐标，会被解析成 [0,0]-[0,0] 的退化区间，
// 于是原生会在该页第一个文本块上做一次高亮，把文本清空（textContent=""）。
// 处理方式：在原生 applySubpath 之前，把浮点 selection 参数摘掉，只保留 page 跳转。
// 这样原生不再画高亮，页码跳转行为保持不变。
// ---------------------------------------------------------------------------

interface PatchedProto {
  applySubpath?: (this: unknown, dest: string) => void;
  [key: string]: unknown;
}

const PATCH_FLAG = "__pdfhlApplySubpathPatched";
const ORIGINAL_KEY = "__pdfhlApplySubpathOriginal";

let patchedProto: PatchedProto | null = null;

function splitQuery(subpath: string): { hash: string; pairs: string[] } {
  const hash = subpath.startsWith("#") ? "#" : "";
  const raw = hash ? subpath.slice(1) : subpath;
  return { hash, pairs: raw.split("&") };
}

function isFloatSelectionPair(pair: string): boolean {
  return pair.startsWith("selection=") && pair.slice("selection=".length).includes(".");
}

/** subpath 是否带浮点（比例坐标）selection 参数 */
export function hasFloatSelectionParam(subpath: string): boolean {
  const { pairs } = splitQuery(subpath);
  return pairs.some(isFloatSelectionPair);
}

/** 摘掉浮点 selection 参数，其余参数（page/rect/height…）原样保留 */
export function stripFloatSelectionParam(subpath: string): string {
  if (!hasFloatSelectionParam(subpath)) return subpath;
  const { hash, pairs } = splitQuery(subpath);
  const kept = pairs.filter((pair) => !isFloatSelectionPair(pair));
  return hash + kept.join("&");
}

/**
 * 给 BV 的 applySubpath 打一次性补丁（所有实例共享原型，调用多次也只生效一次）。
 * 若方法不存在（未来版本改名），静默返回 false，由 textlayerrendered 兜底处理。
 */
export function ensureApplySubpathPatch(bv: BvLike): boolean {
  const proto = Object.getPrototypeOf(bv) as PatchedProto | null;
  if (!proto || typeof proto.applySubpath !== "function") return false;
  if (proto[PATCH_FLAG]) return true;

  const original = proto.applySubpath;
  proto[ORIGINAL_KEY] = original;
  proto.applySubpath = function patchedApplySubpath(this: unknown, dest: string): void {
    const raw = typeof dest === "string" ? dest : String(dest ?? "");
    original.call(this, stripFloatSelectionParam(raw));
  };
  proto[PATCH_FLAG] = true;
  patchedProto = proto;
  return true;
}

/** 卸载插件时还原原型方法，避免影响其他插件与原生行为 */
export function restoreApplySubpathPatch(): void {
  if (!patchedProto) return;
  const original = patchedProto[ORIGINAL_KEY];
  if (typeof original === "function") {
    patchedProto.applySubpath = original as (this: unknown, dest: string) => void;
  }
  delete patchedProto[PATCH_FLAG];
  delete patchedProto[ORIGINAL_KEY];
  patchedProto = null;
}

/** 判断当前 subpathHighight 是否是原生解析出来的退化区间（兜底用） */
export function hasDegenerateNativeHighlight(bv: BvLike): boolean {
  const highlight = bv.subpathHighlight;
  if (!highlight || highlight.type !== "text" || !Array.isArray(highlight.range)) return false;
  return highlight.range.every((pair) => Array.isArray(pair) && pair[0] === 0 && pair[1] === 0);
}

/** 兜底修复：若原生已经画了退化高亮，清掉并重置状态，使后续渲染不再重复 */
export function clearDegenerateNativeHighlight(bv: BvLike): boolean {
  if (!hasDegenerateNativeHighlight(bv)) return false;
  try {
    bv.clearTextHighlight?.();
    bv.subpathHighlight = null;
    return true;
  } catch (error) {
    console.warn("[pdfhl] 清除原生退化高亮失败", error);
    return false;
  }
}
