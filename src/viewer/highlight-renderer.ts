import type { BvLike, HighlightEntry } from "../types.ts";
import { toPercentStyle } from "../core/geometry.ts";
import { entrySnippet } from "../core/link.ts";
import { getStrings } from "../i18n/strings.ts";
import { getPageElement, getPageElements, getViewerContainer, isViewerAlive } from "./pdf-viewer-api.ts";

/** 页面内覆盖层 class（每页一个） */
export const LAYER_CLASS = "pdfhl-layer";
/** 单条高亮 class */
export const ITEM_CLASS = "pdfhl-item";

/**
 * 高亮渲染器：把索引条目画成页面内的半透明矩形。
 * 坐标是百分比，所以缩放、滚动、切换 spread 都不需要重算，只依赖页面元素是否已创建。
 */
export class HighlightRenderer {
  private bv: BvLike;
  private color = "#ffd60a";
  private opacity = 0.35;
  /** 当前条目按页分组（ensureLayers 重试时需要） */
  private entriesByPage = new Map<number, HighlightEntry[]>();
  /** 条目 id → DOM 元素（用于闪烁定位） */
  private itemElements = new Map<string, HTMLElement>();
  private flashTimers = new Map<string, number>();

  constructor(bv: BvLike) {
    this.bv = bv;
  }

  /** 更新颜色与透明度（只改现有元素样式，不重建 DOM） */
  setStyle(color: string, opacity: number): void {
    this.color = color;
    this.opacity = opacity;
    this.applyStyle();
  }

  /** 全量渲染：清掉旧层，再按页重建 */
  render(entries: readonly HighlightEntry[]): void {
    this.clear();
    this.entriesByPage = new Map();
    for (const entry of entries) {
      const list = this.entriesByPage.get(entry.page);
      if (list) list.push(entry);
      else this.entriesByPage.set(entry.page, [entry]);
    }
    this.ensureLayers();
  }

  /**
   * 补齐缺失的图层。
   * pdf.js 的页面是延迟创建/可能重建的，pagerendered 之后调用一次即可。
   */
  ensureLayers(): void {
    if (!isViewerAlive(this.bv)) return;
    for (const [page, list] of this.entriesByPage) {
      const pageEl = getPageElement(this.bv, page);
      if (!pageEl) continue;
      if (pageEl.querySelector(`:scope > .${LAYER_CLASS}`)) continue;
      this.buildLayer(pageEl, list);
    }
    this.applyStyle();
  }

  /** 闪烁指定条目；该页还没建层时返回 false（调用方等 pagerendered 再试） */
  flash(entryId: string): boolean {
    const element = this.itemElements.get(entryId) ?? this.findItemByQuery(entryId);
    if (!element) return false;
    element.classList.remove("is-flash");
    // 强制重排，保证连续两次闪烁都能看到动画
    void element.offsetWidth;
    element.classList.add("is-flash");
    const existing = this.flashTimers.get(entryId);
    if (existing !== undefined) window.clearTimeout(existing);
    const timer = window.setTimeout(() => {
      element.classList.remove("is-flash");
      this.flashTimers.delete(entryId);
    }, 1200);
    this.flashTimers.set(entryId, timer);
    return true;
  }

  /** 删除所有覆盖层与定时器（容忍视图已卸载） */
  clear(): void {
    for (const timer of this.flashTimers.values()) window.clearTimeout(timer);
    this.flashTimers.clear();
    this.itemElements.clear();
    try {
      for (const pageEl of getPageElements(this.bv)) {
        pageEl.querySelectorAll(`:scope > .${LAYER_CLASS}`).forEach((layer) => layer.remove());
      }
      // 兜底：容器内可能残留在页面之外的层（页面重建过程中）
      getViewerContainer(this.bv)?.querySelectorAll(`.${LAYER_CLASS}`).forEach((layer) => layer.remove());
    } catch (error) {
      console.debug("[pdfhl] 清理高亮层失败（视图可能已卸载）", error);
    }
  }

  destroy(): void {
    try {
      this.clear();
    } finally {
      this.entriesByPage.clear();
    }
  }

  private buildLayer(pageEl: HTMLElement, entries: readonly HighlightEntry[]): void {
    const layer = pageEl.createDiv({ cls: LAYER_CLASS });
    for (const entry of entries) {
      const item = layer.createDiv({ cls: ITEM_CLASS });
      const style = toPercentStyle(entry.rect);
      item.style.left = style.left;
      item.style.top = style.top;
      item.style.width = style.width;
      item.style.height = style.height;
      item.dataset.entryId = entry.id;
      item.dataset.kind = entry.kind;
      item.title = getStrings().panelPageTitle(entry.page, entrySnippet(entry.text, entry.kind));
      this.itemElements.set(entry.id, item);
    }
  }

  private applyStyle(): void {
    const background = this.color;
    const opacity = String(this.opacity);
    for (const element of this.itemElements.values()) {
      element.style.backgroundColor = background;
      element.style.opacity = opacity;
    }
  }

  private findItemByQuery(entryId: string): HTMLElement | null {
    for (const pageEl of getPageElements(this.bv)) {
      const found = pageEl.querySelector<HTMLElement>(`.${ITEM_CLASS}[data-entry-id="${entryId}"]`);
      if (found) return found;
    }
    return null;
  }
}
