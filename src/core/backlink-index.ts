import { parseLinktext } from "obsidian";
import type { App, LinkCache, TFile } from "obsidian";
import type { HighlightEntry } from "../types.ts";
import { getStrings } from "../i18n/strings.ts";
import { parseHighlightSubpath, extractQuoteLine } from "./link.ts";

/**
 * Obsidian 的 getBacklinksForFile 未出现在公开类型定义里（PDF++ 等插件也用内部 API）。
 * 这里声明最小的运行时结构，调用前做特征探测。
 */
interface BacklinkReferences {
  keys(): Iterable<string>;
  get(path: string): LinkCache[] | undefined;
}

interface MetadataCacheWithBacklinks {
  getBacklinksForFile?: (file: TFile) => BacklinkReferences | null;
}

/** 读取某个 PDF 的反向链接集合；不支持时返回 null（调用方展示为空即可） */
function readBacklinks(app: App, pdfFile: TFile): BacklinkReferences | null {
  const cache = app.metadataCache as unknown as MetadataCacheWithBacklinks;
  const read = cache.getBacklinksForFile;
  if (typeof read !== "function") return null;
  try {
    return read.call(cache, pdfFile) ?? null;
  } catch (error) {
    console.warn("[pdfhl] 读取反向链接失败", error);
    return null;
  }
}

function compareEntries(a: HighlightEntry, b: HighlightEntry): number {
  if (a.page !== b.page) return a.page - b.page;
  if (a.rect.y !== b.rect.y) return a.rect.y - b.rect.y;
  return a.rect.x - b.rect.x;
}

/**
 * 由反向链接构建高亮索引。
 * 只保留带 page + selection/rect 参数的链接；同一位置重复链接去重（保留第一条）。
 *
 * 引用式链接（复制引用）的别名是「文件名.pdf, X 页」，选中文字放在链接上一行的引用块里，
 * 所以这里额外读一次来源笔记，把引用行取回来当面板片段。
 */
export async function buildHighlightIndex(app: App, pdfFile: TFile): Promise<HighlightEntry[]> {
  const references = readBacklinks(app, pdfFile);
  if (!references) return [];

  const entries: HighlightEntry[] = [];
  const seen = new Set<string>();

  for (const sourcePath of references.keys()) {
    const caches = references.get(sourcePath);
    if (!caches || caches.length === 0) continue;
    for (const cache of caches) {
      // link 形如 "note.md#page=3&selection=..."，取 # 后的部分
      const subpath = parseLinktext(cache.link).subpath;
      const parsed = parseHighlightSubpath(subpath);
      if (!parsed) continue;

      const { page, kind, rect, rects } = parsed;
      // 单区域沿用旧 id（面板/闪烁状态不变）；多区域用全部坐标去重
      const id = rects.length > 1
        ? `${page}:${kind}:${rects.map((item) => `${item.x},${item.y},${item.w},${item.h}`).join(";")}`
        : `${page}:${kind}:${rect.x},${rect.y},${rect.w},${rect.h}`;
      if (seen.has(id)) continue;
      seen.add(id);

      entries.push({
        id,
        file: pdfFile,
        page,
        kind,
        rect,
        rects,
        text: cache.displayText ?? "",
        sourcePath,
        line: cache.position?.start?.line ?? 0,
        rawLink: cache.link,
      });
    }
  }

  await fillQuoteTexts(app, entries);

  entries.sort(compareEntries);
  return entries;
}

/** 别名形如「文件.pdf, 第 3 页」时说明文字在引用行里，别名本身没有阅读价值 */
function looksLikeNativeAlias(text: string): boolean {
  const value = text.trim();
  return getStrings().nativeAliasPatterns.some((pattern) => pattern.test(value));
}

/**
 * 从来源笔记里把文字高亮对应的引用行取出来填充 entry.text。
 * 一个来源笔记只读一次；读取失败就保留别名，不阻塞渲染。
 */
async function fillQuoteTexts(app: App, entries: HighlightEntry[]): Promise<void> {
  const bySource = new Map<string, HighlightEntry[]>();
  for (const entry of entries) {
    if (entry.kind !== "text") continue;
    const list = bySource.get(entry.sourcePath);
    if (list) list.push(entry);
    else bySource.set(entry.sourcePath, [entry]);
  }

  for (const [sourcePath, list] of bySource) {
    const target = app.vault.getAbstractFileByPath(sourcePath) as TFile | null;
    if (!target || typeof target !== "object" || !("extension" in target)) continue;
    let content: string;
    try {
      content = await app.vault.cachedRead(target);
    } catch (error) {
      console.warn("[pdfhl] 读取来源笔记失败", sourcePath, error);
      continue;
    }
    const lines = content.split(/\r?\n/);
    for (const entry of list) {
      if (entry.text && !looksLikeNativeAlias(entry.text)) continue;
      entry.text = extractQuoteLine(lines, entry.line);
    }
  }
}

/** 按页码分组（页码升序，组内按 y/x 排序） */
export function groupByPage(entries: readonly HighlightEntry[]): Array<{ page: number; entries: HighlightEntry[] }> {
  const groups = new Map<number, HighlightEntry[]>();
  for (const entry of entries) {
    const list = groups.get(entry.page);
    if (list) list.push(entry);
    else groups.set(entry.page, [entry]);
  }
  return Array.from(groups.entries())
    .map(([page, list]) => ({ page, entries: list.slice().sort(compareEntries) }))
    .sort((a, b) => a.page - b.page);
}

/** 来源笔记的显示名（去掉目录与 .md 后缀） */
export function sourceDisplayName(sourcePath: string): string {
  const name = sourcePath.split("/").pop() ?? sourcePath;
  return name.endsWith(".md") ? name.slice(0, -3) : name;
}
