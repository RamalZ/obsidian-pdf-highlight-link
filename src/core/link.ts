import type { App, TFile } from "obsidian";
import type { HighlightMode, NormRect, ParsedHighlight } from "../types.ts";
import { unionRects } from "./geometry.ts";
import { getStrings } from "../i18n/strings.ts";

/** 坐标保留的小数位数（4 位 ≈ 页面千分之一像素级，足够精确且链接短） */
export const COORD_PRECISION = 4;

/** 高亮矩形的最小边长（归一化），小于该值视为误触/无效 */
export const MIN_RECT_SIZE = 0.002;

/** 四舍五入到固定精度，避免浮点噪声写进链接 */
export function roundCoord(value: number): number {
  const factor = 10 ** COORD_PRECISION;
  return Math.round(value * factor) / factor;
}

/** 数字 → 链接里的紧凑字符串：0.5 → "0.5"，1 → "1" */
export function formatCoord(value: number): string {
  return String(roundCoord(value));
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/**
 * 把 (x1,y1)-(x2,y2) 两个角点整理成左上角 + 宽高的归一化矩形。
 * 先按大小方向归一，再夹到页面内，最后检查退化。无效返回 null。
 */
export function normalizeRect(x1: number, y1: number, x2: number, y2: number): NormRect | null {
  if (![x1, y1, x2, y2].every((n) => Number.isFinite(n))) return null;
  const left = Math.min(x1, x2);
  const top = Math.min(y1, y2);
  const x = clamp01(left);
  const y = clamp01(top);
  // 宽高按夹取后的起点截断，保证矩形不越出页面
  const rawW = Math.abs(x2 - x1);
  const rawH = Math.abs(y2 - y1);
  const w = roundCoord(Math.min(rawW, 1 - x));
  const h = roundCoord(Math.min(rawH, 1 - y));
  if (w < MIN_RECT_SIZE || h < MIN_RECT_SIZE) return null;
  return { x: roundCoord(x), y: roundCoord(y), w, h };
}

/** 校验 rect=x,y,w,h 语义（起点 + 宽高）；负数宽高自动翻转 */
export function makeRectFromSize(x: number, y: number, w: number, h: number): NormRect | null {
  if (![x, y, w, h].every((n) => Number.isFinite(n))) return null;
  let left = x;
  let top = y;
  let width = w;
  let height = h;
  if (width < 0) {
    left += width;
    width = -width;
  }
  if (height < 0) {
    top += height;
    height = -height;
  }
  return normalizeRect(left, top, left + width, top + height);
}

/** 逗号分隔的数字串 → 恰好 4 个有限数字；否则 null */
function splitFourNumbers(raw: string): [number, number, number, number] | null {
  const parts = raw.split(",");
  if (parts.length < 4) return null;
  const values: number[] = [];
  for (let i = 0; i < 4; i += 1) {
    const text = parts[i].trim();
    if (!text) return null;
    const value = Number(text);
    if (!Number.isFinite(value)) return null;
    values.push(value);
  }
  return [values[0], values[1], values[2], values[3]];
}

/** 解析 rects=x,y,w,h;x,y,w,h；任一段非法就整体判为非法（调用方回退旧参数） */
function parseRectGroups(raw: string): NormRect[] | null {
  const groups = raw
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (groups.length === 0) return null;
  const rects: NormRect[] = [];
  for (const group of groups) {
    const values = splitFourNumbers(group);
    if (!values) return null;
    const rect = makeRectFromSize(values[0], values[1], values[2], values[3]);
    if (!rect) return null;
    rects.push(rect);
  }
  return rects;
}

/**
 * Markdown 链接里的 subpath 可能被 URL 编码（`#page%3D3%26selection%3D…`），
 * 解析前先解码；编码不合法时原样返回，交给后续校验。
 */
export function decodeSubpath(subpath: string): string {
  if (!subpath.includes("%")) return subpath;
  try {
    return decodeURIComponent(subpath);
  } catch {
    return subpath;
  }
}

/**
 * 解析链接 subpath（形如 "#page=3&selection=0.1,0.2,0.3,0.4"）。
 * 规则：page 必须是正整数；优先级 rects > rect > selection（rects 是跨栏文字选区的多区域格式）。
 * 解析失败返回 null，调用方应静默跳过（不打扰用户）。
 */
export function parseHighlightSubpath(subpath: string | null | undefined): ParsedHighlight | null {
  if (!subpath) return null;
  let raw = decodeSubpath(subpath);
  if (raw.startsWith("#")) raw = raw.slice(1);
  if (!raw) return null;

  let params: URLSearchParams;
  try {
    params = new URLSearchParams(raw);
  } catch {
    return null;
  }

  const pageText = params.get("page");
  if (pageText === null) return null;
  const page = Number.parseInt(pageText, 10);
  if (!Number.isFinite(page) || page < 1) return null;

  // 多区域文字选区：rects=x,y,w,h;x,y,w,h（本次新增，优先于单矩形）
  const rectsText = params.get("rects");
  if (rectsText !== null) {
    const rects = parseRectGroups(rectsText);
    if (rects && rects.length > 0) {
      const rect = unionRects(rects);
      if (rect) return { page, kind: "text", rect, rects };
    }
    // rects 非法时继续尝试旧的 rect/selection，兼容被手工改坏的链接
  }

  const rectText = params.get("rect");
  if (rectText !== null) {
    const values = splitFourNumbers(rectText);
    if (!values) return null;
    const rect = makeRectFromSize(values[0], values[1], values[2], values[3]);
    return rect ? { page, kind: "rect", rect, rects: [rect] } : null;
  }

  const selectionText = params.get("selection");
  if (selectionText !== null) {
    const values = splitFourNumbers(selectionText);
    if (!values) return null;
    const rect = normalizeRect(values[0], values[1], values[2], values[3]);
    return rect ? { page, kind: "text", rect, rects: [rect] } : null;
  }

  // 只有 page：原生页码跳转链接，不是高亮
  return null;
}

/** 文字型 subpath：selection=x1,y1,x2,y2（对角两点） */
export function buildTextSubpath(page: number, rect: NormRect): string {
  const r = clampRectForLink(rect);
  return `#page=${page}&selection=${formatCoord(r.x)},${formatCoord(r.y)},${formatCoord(r.x + r.w)},${formatCoord(r.y + r.h)}`;
}

/** 区域型 subpath：rect=x,y,w,h（起点 + 尺寸） */
export function buildRectSubpath(page: number, rect: NormRect): string {
  const r = clampRectForLink(rect);
  return `#page=${page}&rect=${formatCoord(r.x)},${formatCoord(r.y)},${formatCoord(r.w)},${formatCoord(r.h)}`;
}

/**
 * 多区域文字型 subpath：rects=x,y,w,h;x,y,w,h
 * 用于跨栏选区，避免用外接矩形把栏间空白一起高亮。单区域仍写旧的 selection 格式。
 */
export function buildTextRectsSubpath(page: number, rects: readonly NormRect[]): string {
  const normalized = rects
    .filter((rect) => [rect.x, rect.y, rect.w, rect.h].every((value) => Number.isFinite(value)))
    .map((rect) => clampRectForLink(rect))
    .filter((rect) => rect.w >= MIN_RECT_SIZE && rect.h >= MIN_RECT_SIZE);
  if (normalized.length === 0) return `#page=${page}`;
  if (normalized.length === 1) return buildTextSubpath(page, normalized[0]);
  const value = normalized
    .map((rect) => `${formatCoord(rect.x)},${formatCoord(rect.y)},${formatCoord(rect.w)},${formatCoord(rect.h)}`)
    .join(";");
  return `#page=${page}&rects=${value}`;
}

/** 按类型生成 subpath；文字型传入多个区域时使用 rects 格式 */
export function buildSubpath(
  page: number,
  kind: HighlightMode,
  rect: NormRect,
  rects?: readonly NormRect[] | null,
): string {
  if (kind === "text" && rects && rects.length > 1) return buildTextRectsSubpath(page, rects);
  return kind === "rect" ? buildRectSubpath(page, rect) : buildTextSubpath(page, rect);
}

/** 生成链接前再夹一次，防止外部调用传入越界矩形 */
function clampRectForLink(rect: NormRect): NormRect {
  const x = clamp01(rect.x);
  const y = clamp01(rect.y);
  return {
    x: roundCoord(x),
    y: roundCoord(y),
    w: roundCoord(Math.min(clamp01(rect.w), 1 - x)),
    h: roundCoord(Math.min(clamp01(rect.h), 1 - y)),
  };
}

/**
 * 清洗别名：Obsidian 笔记链接里 "|" 与 "]]" 会破坏语法，换行也会截断链接。
 * 用全角字符替换，视觉上几乎无差别。
 */
export function sanitizeAlias(input: string | null | undefined): string {
  if (!input) return "";
  let text = input.replace(/\r\n?/g, "\n");
  text = text.replace(/\[\[/g, "［［").replace(/\]\]/g, "］］").replace(/\|/g, "｜");
  text = text.replace(/\s+/g, " ").trim();
  return text;
}

/** 别名兜底：文字型「文字高亮」，区域型「区域批注」 */
export function resolveAlias(input: string | null | undefined, kind: HighlightMode): string {
  const alias = sanitizeAlias(input);
  if (alias) return alias;
  return getStrings().aliasForKind(kind);
}

/** 面板里展示的内容片段：文字型取前 30 字，区域型固定文案 */
export function entrySnippet(text: string, kind: HighlightMode): string {
  if (kind === "rect") return getStrings().snippetFallback(kind);
  const cleaned = sanitizeAlias(text);
  if (!cleaned) return getStrings().snippetFallback(kind);
  return cleaned.length > 30 ? `${cleaned.slice(0, 30)}…` : cleaned;
}

/**
 * 生成可粘贴进笔记的 PDF 链接。
 * 优先交给 Obsidian 的 generateMarkdownLink（自动处理相对路径与 Wiki/Markdown 链接设置），
 * 失败时回退到手拼 Wiki 链接。
 */
export function createPdfLink(
  app: App,
  pdfFile: TFile,
  sourcePath: string,
  page: number,
  kind: HighlightMode,
  rect: NormRect,
  alias: string | null | undefined,
  rects?: readonly NormRect[] | null,
): string {
  const subpath = buildSubpath(page, kind, rect, rects);
  const safeAlias = resolveAlias(alias, kind);
  try {
    return app.fileManager.generateMarkdownLink(pdfFile, sourcePath, subpath, safeAlias);
  } catch (error) {
    console.warn("[pdfhl] generateMarkdownLink 失败，回退手动拼接", error);
    const linktext = app.metadataCache.fileToLinktext(pdfFile, sourcePath, true);
    return `[[${linktext}${subpath}|${safeAlias}]]`;
  }
}

/**
 * 引用块里链接的别名：跟 Obsidian 原生 PDF 引用保持一致，形如「文件名.pdf, 第 3 页」。
 */
export function buildLinkAlias(fileName: string, page: number): string {
  return getStrings().aliasForPage(fileName, page);
}

/**
 * 生成「复制引用」要粘贴的块，布局与 Obsidian 原生 PDF 引用一致：
 *
 * 文字选区：
 * > 选中的文字
 * （空行）
 * [[文件.pdf#page=3&selection=...|文件.pdf, 第 3 页]]
 *
 * 框选区域：引用行留一句占位文案，由使用者自己补写区域内容。
 */
export function buildReferenceBlock(
  link: string,
  kind: HighlightMode,
  quoteText: string | null | undefined,
): string {
  const placeholder = getStrings().referencePlaceholder;
  const source = (quoteText ?? "").length > 0 ? (quoteText ?? "") : kind === "rect" ? placeholder : "";
  const lines = source
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  // 每行都加 "> "，否则换行会跑到引用块外面；引用行与链接之间空一行，跟原生 PDF 引用一致
  const quoted = lines.length > 0 ? lines.map((line) => `> ${line}`).join("\n") : ">";
  return `${quoted}\n\n${link}`;
}

/**
 * 从链接所在行往上找最近的非空行，要求是引用行（"> ..."），最多看 3 行。
 * 找不到（或中间先遇到普通段落）就返回空字符串，避免误取别的段落。
 */
export function extractQuoteLine(lines: readonly string[], linkLine: number): string {
  const start = Math.min(linkLine - 1, lines.length - 1);
  for (let i = start; i >= 0 && i >= linkLine - 3; i -= 1) {
    const raw = (lines[i] ?? "").trim();
    if (!raw) continue;
    if (!raw.startsWith(">")) return "";
    // 去掉引用前缀与紧跟的空格，多行引用只取第一行
    return raw.replace(/^>\s?/, "").trim();
  }
  return "";
}

/**
 * 写入剪贴板：优先异步 Clipboard API，失败退化到 textarea + execCommand。
 * 返回是否成功（调用方据此提示用户）。
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 常见于窗口失焦；继续尝试回退方案
  }
  try {
    const doc = document;
    const area = doc.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "true");
    area.style.position = "fixed";
    area.style.top = "-1000px";
    area.style.opacity = "0";
    doc.body.appendChild(area);
    area.select();
    const ok = doc.execCommand("copy");
    area.remove();
    return ok;
  } catch (error) {
    console.error("[pdfhl] 复制链接失败", error);
    return false;
  }
}
