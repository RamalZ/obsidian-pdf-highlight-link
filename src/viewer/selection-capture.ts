import type { BvLike, NormRect } from "../types.ts";
import {
  buildSelectionRegions,
  findPageElement,
  getPageContentRect,
  getPageNumberOf,
  isUsableRect,
  normalizeClientRect,
  unionRects,
} from "../core/geometry.ts";

export interface TextSelectionResult {
  page: number;
  /** 所有区域的并集（浮动工具栏锚点、兼容旧调用） */
  rect: NormRect;
  /** 按栏拆分后的实际高亮区域；单栏时只有一块 */
  rects: NormRect[];
  alias: string;
  anchor: { left: number; top: number; right: number; bottom: number };
}

/**
 * 文字选区捕获：在 PDF 容器上监听 mouseup / Shift+方向键，
 * 把浏览器的选区换算成页面比例坐标后交给调用方弹浮动工具栏。
 */
export class SelectionCapture {
  private bv: BvLike;
  private container: HTMLElement;
  private enabled: () => boolean;
  private onSelect: (result: TextSelectionResult | null) => void;
  private started = false;

  constructor(
    bv: BvLike,
    container: HTMLElement,
    enabled: () => boolean,
    onSelect: (result: TextSelectionResult | null) => void,
  ) {
    this.bv = bv;
    this.container = container;
    this.enabled = enabled;
    this.onSelect = onSelect;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.container.addEventListener("mouseup", this.handleMouseUp, true);
    this.container.ownerDocument.addEventListener("keyup", this.handleKeyUp, true);
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.container.removeEventListener("mouseup", this.handleMouseUp, true);
    this.container.ownerDocument.removeEventListener("keyup", this.handleKeyUp, true);
  }

  private handleMouseUp = (event: MouseEvent): void => {
    if (!this.enabled() || event.button !== 0) return;
    // 等浏览器把选区定下来再读取
    const win = this.container.ownerDocument.defaultView ?? window;
    win.setTimeout(() => this.evaluate(), 0);
  };

  private handleKeyUp = (event: KeyboardEvent): void => {
    if (!this.enabled() || !event.shiftKey) return;
    const win = this.container.ownerDocument.defaultView ?? window;
    win.setTimeout(() => this.evaluate(), 0);
  };

  private evaluate(): void {
    const doc = this.container.ownerDocument;
    const selection = doc.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      this.onSelect(null);
      return;
    }

    const range = selection.getRangeAt(0);
    if (!this.container.contains(range.commonAncestorContainer)) {
      this.onSelect(null);
      return;
    }

    const pageEl = findPageElement(range.startContainer);
    if (!pageEl || !this.container.contains(pageEl)) {
      this.onSelect(null);
      return;
    }
    const page = getPageNumberOf(pageEl);
    if (!Number.isFinite(page) || page < 1) {
      this.onSelect(null);
      return;
    }

    const box = getPageContentRect(pageEl);
    const rects: NormRect[] = [];
    const clients: Array<{ left: number; top: number; right: number; bottom: number }> = [];

    for (const client of Array.from(range.getClientRects())) {
      if (client.width < 1 || client.height < 1) continue;
      // 跨页选区只保留与起始页相交的部分
      if (
        client.right <= box.left ||
        client.left >= box.left + box.width ||
        client.bottom <= box.top ||
        client.top >= box.top + box.height
      ) {
        continue;
      }
      const rect = normalizeClientRect(box, client);
      if (!isUsableRect(rect)) continue;
      rects.push(rect);
      clients.push({ left: client.left, top: client.top, right: client.right, bottom: client.bottom });
    }

    const merged = unionRects(rects);
    if (!merged) {
      this.onSelect(null);
      return;
    }

    const regions = buildSelectionRegions(rects);
    this.onSelect({
      page,
      rect: merged,
      rects: regions.length > 0 ? regions : [merged],
      alias: selection.toString(),
      anchor: {
        left: Math.min(...clients.map((c) => c.left)),
        top: Math.min(...clients.map((c) => c.top)),
        right: Math.max(...clients.map((c) => c.right)),
        bottom: Math.max(...clients.map((c) => c.bottom)),
      },
    });
  }
}
