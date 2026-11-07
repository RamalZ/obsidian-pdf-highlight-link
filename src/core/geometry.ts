import type { NormRect } from "../types.ts";

/** 可用矩形的最小边长（归一化），比 link 里的阈值略严，用于交互层丢弃误触 */
export const MIN_GEOMETRY_SIZE = 0.002;

/** 页面内容盒（视口坐标系，已扣除 9px 透明边框） */
export interface ClientBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** 任意 DOMRect 风格的对象（用接口避免依赖具体类型） */
export interface RectLike {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/** 夹到页面内，并保证宽高非负 */
export function clampRect(rect: NormRect): NormRect {
  const x = clamp01(rect.x);
  const y = clamp01(rect.y);
  const w = Math.max(0, Math.min(Number.isFinite(rect.w) ? rect.w : 0, 1 - x));
  const h = Math.max(0, Math.min(Number.isFinite(rect.h) ? rect.h : 0, 1 - y));
  return { x, y, w, h };
}

/** 由两个任意角点生成矩形（自动处理反向拖拽） */
export function rectFromPoints(ax: number, ay: number, bx: number, by: number): NormRect {
  return {
    x: Math.min(ax, bx),
    y: Math.min(ay, by),
    w: Math.abs(bx - ax),
    h: Math.abs(by - ay),
  };
}

/** 多个矩形求外接矩形；空数组返回 null */
export function unionRects(rects: readonly NormRect[]): NormRect | null {
  if (rects.length === 0) return null;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const rect of rects) {
    if (!Number.isFinite(rect.x) || !Number.isFinite(rect.y)) continue;
    const w = Number.isFinite(rect.w) ? rect.w : 0;
    const h = Number.isFinite(rect.h) ? rect.h : 0;
    minX = Math.min(minX, rect.x);
    minY = Math.min(minY, rect.y);
    maxX = Math.max(maxX, rect.x + w);
    maxY = Math.max(maxY, rect.y + h);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
  return clampRect({ x: minX, y: minY, w: maxX - minX, h: maxY - minY });
}

/** 尺寸是否够大（过滤点击、极小选区） */
export function isUsableRect(rect: NormRect, min = MIN_GEOMETRY_SIZE): boolean {
  return rect.w >= min && rect.h >= min;
}

function percent(value: number): string {
  return `${(clamp01(value) * 100).toFixed(3)}%`;
}

/** 归一化矩形 → 覆盖层样式：百分比定位，缩放/滚动无需重算 */
export function toPercentStyle(rect: NormRect): { left: string; top: string; width: string; height: string } {
  const r = clampRect(rect);
  return {
    left: percent(r.x),
    top: percent(r.y),
    width: percent(r.w),
    height: percent(r.h),
  };
}

/**
 * 视口坐标的矩形 → 页面归一化矩形。
 * 注意：必须用内容盒（扣除边框）的 left/top/width/height，不能用页面元素的外接矩形。
 */
export function normalizeClientRect(box: ClientBox, client: RectLike): NormRect {
  if (box.width <= 0 || box.height <= 0) return { x: 0, y: 0, w: 0, h: 0 };
  const x1 = (client.left - box.left) / box.width;
  const y1 = (client.top - box.top) / box.height;
  const x2 = (client.right - box.left) / box.width;
  const y2 = (client.bottom - box.top) / box.height;
  return clampRect(rectFromPoints(x1, y1, x2, y2));
}

/** 取页面元素的内容盒（视口坐标系）：clientLeft/Top 正好是 9px 透明边框宽度 */
export function getPageContentRect(pageEl: HTMLElement): ClientBox {
  const rect = pageEl.getBoundingClientRect();
  return {
    left: rect.left + pageEl.clientLeft,
    top: rect.top + pageEl.clientTop,
    width: pageEl.clientWidth,
    height: pageEl.clientHeight,
  };
}

/** 从选区节点向上找所属的 .page 元素（找不到返回 null） */
export function findPageElement(node: Node | null | undefined): HTMLElement | null {
  if (!node) return null;
  const element = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element);
  if (!element || typeof element.closest !== "function") return null;
  return element.closest<HTMLElement>(".page[data-page-number]");
}

/** 页面元素的页码（1 起） */
export function getPageNumberOf(pageEl: HTMLElement): number {
  return Number.parseInt(pageEl.dataset.pageNumber ?? "", 10);
}

/** 两个矩形是否相交（用于跨页选区裁剪） */
export function rectsIntersect(a: NormRect, b: NormRect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
