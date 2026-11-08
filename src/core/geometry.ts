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

/** 文字选区按列拆分时的可调参数（均为页面归一化比例） */
export interface SelectionRegionOptions {
  /** 同一行内，大于该水平间隙就视为相邻两栏；默认 0.02 */
  columnGap?: number;
  /** 相邻两行之间允许的最大垂直间隙；默认 0.012 */
  lineGap?: number;
  /** 纵向合并所需的最小水平重叠率（交集 / 较宽矩形）；默认 0.5 */
  minOverlapRatio?: number;
  /** 纵向合并允许的最大宽度比；默认 1.7 */
  maxWidthRatio?: number;
}

interface RegionTrack {
  bounds: NormRect;
  last: NormRect;
}

interface SelectionRow {
  rects: NormRect[];
  segments: NormRect[];
}

const DEFAULT_COLUMN_GAP = 0.02;
const DEFAULT_LINE_GAP = 0.012;
const DEFAULT_MIN_OVERLAP_RATIO = 0.5;
const DEFAULT_MAX_WIDTH_RATIO = 1.7;

function positiveOption(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function horizontalOverlap(a: NormRect, b: NormRect): number {
  return Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
}

function sameTextRow(a: NormRect, b: NormRect): boolean {
  const overlap = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  const minHeight = Math.min(a.h, b.h);
  if (overlap >= minHeight * 0.25) return true;
  // 上标/下标等极端情况：顶端几乎对齐也当作同一行
  return Math.abs(a.y - b.y) <= MIN_GEOMETRY_SIZE * 1.5;
}

function mergeRects(a: NormRect, b: NormRect): NormRect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return clampRect({
    x,
    y,
    w: Math.max(a.x + a.w, b.x + b.w) - x,
    h: Math.max(a.y + a.h, b.y + b.h) - y,
  });
}

function buildRows(rects: readonly NormRect[]): SelectionRow[] {
  const sorted = rects.slice().sort((a, b) => (a.y - b.y) || (a.x - b.x));
  const rows: SelectionRow[] = [];
  for (const rect of sorted) {
    const row = rows[rows.length - 1];
    if (row && row.rects.some((existing) => sameTextRow(existing, rect))) {
      row.rects.push(rect);
    } else {
      rows.push({ rects: [rect], segments: [] });
    }
  }
  return rows;
}

function splitRowIntoSegments(row: SelectionRow, columnGap: number): NormRect[] {
  const sorted = row.rects.slice().sort((a, b) => a.x - b.x);
  const segments: NormRect[] = [];
  for (const rect of sorted) {
    const current = segments[segments.length - 1];
    if (current && rect.x - (current.x + current.w) <= columnGap) {
      segments[segments.length - 1] = mergeRects(current, rect);
    } else {
      segments.push({ ...rect });
    }
  }
  return segments;
}

function isSpanningSegment(
  segment: NormRect,
  row: SelectionRow,
  rows: readonly SelectionRow[],
): boolean {
  if (row.segments.length !== 1 || segment.w < 0.35) return false;
  const rowTop = Math.min(...row.segments.map((item) => item.y));
  const rowBottom = Math.max(...row.segments.map((item) => item.y + item.h));
  for (const neighbour of rows) {
    if (neighbour === row || neighbour.segments.length < 2) continue;
    const neighbourTop = Math.min(...neighbour.segments.map((item) => item.y));
    const neighbourBottom = Math.max(...neighbour.segments.map((item) => item.y + item.h));
    const verticalGap = Math.max(neighbourTop - rowBottom, rowTop - neighbourBottom, 0);
    if (verticalGap > 0.12) continue;
    let covered = 0;
    for (const other of neighbour.segments) {
      if (horizontalOverlap(segment, other) >= Math.min(segment.w, other.w) * 0.2) covered += 1;
    }
    if (covered >= 2) return true;
  }
  return false;
}

function tryMergeTrack(
  track: RegionTrack,
  segment: NormRect,
  lineGap: number,
  minOverlapRatio: number,
  maxWidthRatio: number,
  columnGap: number,
): boolean {
  const gap = segment.y - (track.last.y + track.last.h);
  if (gap > lineGap) return false;
  if (gap < -Math.max(track.last.h, segment.h)) return false;
  const overlapRatio = horizontalOverlap(track.last, segment) / Math.max(track.last.w, segment.w, 1e-9);
  const minWidth = Math.max(Math.min(track.last.w, segment.w), 1e-9);
  const widthRatio = Math.max(track.last.w, segment.w) / minWidth;
  if (overlapRatio >= minOverlapRatio && widthRatio <= maxWidthRatio) return true;
  // 段落最后一行常常明显更短：左边缘对齐时也允许合并
  const leftAligned = Math.abs(track.last.x - segment.x) <= columnGap * 0.75;
  return leftAligned && track.last.w <= 0.6 && segment.w <= track.last.w;
}

/**
 * 把文字选区里的若干行矩形拆成「按栏」的区域。
 *
 * PDF 的文字层对跨栏选区会返回左栏一行、右栏一行……如果直接取外接矩形，
 * 高亮会横跨两栏之间的整块空白（看起来像高亮整页）。这里先按行分组，
 * 再在行内按水平间隙拆栏，最后纵向合并同一栏的相邻行；通栏标题单独成块。
 */
export function buildSelectionRegions(
  rects: readonly NormRect[],
  options: SelectionRegionOptions = {},
): NormRect[] {
  const columnGap = positiveOption(options.columnGap, DEFAULT_COLUMN_GAP);
  const lineGap = positiveOption(options.lineGap, DEFAULT_LINE_GAP);
  const minOverlapRatio = positiveOption(options.minOverlapRatio, DEFAULT_MIN_OVERLAP_RATIO);
  const maxWidthRatio = positiveOption(options.maxWidthRatio, DEFAULT_MAX_WIDTH_RATIO);

  const usable = rects
    .filter((rect) => [rect.x, rect.y, rect.w, rect.h].every((value) => Number.isFinite(value)))
    .map((rect) => clampRect(rect))
    .filter((rect) => isUsableRect(rect));
  if (usable.length <= 1) return usable;

  const rows = buildRows(usable);
  for (const row of rows) row.segments = splitRowIntoSegments(row, columnGap);

  const tracks: RegionTrack[] = [];
  const spanning: RegionTrack[] = [];

  for (const row of rows) {
    for (const segment of row.segments) {
      const target = isSpanningSegment(segment, row, rows) ? spanning : tracks;
      let bestIndex = -1;
      let bestOverlap = -1;
      for (let i = 0; i < target.length; i += 1) {
        const track = target[i];
        if (!tryMergeTrack(track, segment, lineGap, minOverlapRatio, maxWidthRatio, columnGap)) continue;
        const overlap = horizontalOverlap(track.last, segment);
        if (overlap > bestOverlap) {
          bestOverlap = overlap;
          bestIndex = i;
        }
      }
      if (bestIndex >= 0) {
        const track = target[bestIndex];
        track.bounds = mergeRects(track.bounds, segment);
        track.last = segment;
      } else {
        target.push({ bounds: { ...segment }, last: segment });
      }
    }
  }

  return [...tracks, ...spanning]
    .map((track) => track.bounds)
    .sort((a, b) => (a.y - b.y) || (a.x - b.x));
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

/**
 * 计算内嵌控件（overlay）的 CSS right 值：
 * 让它整体位于原生控件左侧，并保留 gap 间距。
 * actionsLeft 可以是单个 left，也可以是多个候选 left（取最左）。
 * 参数均为视口坐标/像素；无法测量时退回保守的 min。
 */
export function computeOverlayRight(
  parentRight: number,
  actionsLeft: number | readonly number[],
  gap = 8,
  min = 6,
): number {
  const left = typeof actionsLeft === "number" ? actionsLeft : earliestFiniteLeft(actionsLeft);
  if (!Number.isFinite(parentRight) || left === null || !Number.isFinite(left) || !Number.isFinite(gap)) {
    return min;
  }
  return Math.max(min, Math.ceil(parentRight - left + gap));
}

function earliestFiniteLeft(values: readonly number[]): number | null {
  let best: number | null = null;
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    if (best === null || value < best) best = value;
  }
  return best;
}
