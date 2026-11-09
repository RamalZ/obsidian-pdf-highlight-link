import type { NormRect } from "../types.ts";
import { clamp01, getPageContentRect, getPageNumberOf, isUsableRect, rectFromPoints, toPercentStyle } from "../core/geometry.ts";

export interface RectCaptureResult {
  page: number;
  rect: NormRect;
  anchor: { left: number; top: number; right: number; bottom: number };
}

/** 小于该比例的区域视为误触（约 0.5% 页面宽高） */
const MIN_DRAG_SIZE = 0.005;
/** 小于该像素位移时视为普通点击，不弹工具栏 */
const MIN_DRAG_PIXELS = 4;

interface ActiveDrag {
  pageEl: HTMLElement;
  page: number;
  box: { left: number; top: number; width: number; height: number };
  startX: number;
  startY: number;
  startClientX: number;
  startClientY: number;
  pointerId: number;
  marquee: HTMLElement;
  rect: NormRect | null;
  currentX: number;
  currentY: number;
}

/**
 * 框选捕获：框选模式下在页面上按下并拖拽出矩形，松开后回调。
 * 使用 pointer capture，避免拖出页面后丢事件；Esc 或 pointercancel 取消。
 */
export class RectCapture {
  private container: HTMLElement;
  private enabled: () => boolean;
  private onComplete: (result: RectCaptureResult | null) => void;
  private drag: ActiveDrag | null = null;
  private started = false;

  constructor(container: HTMLElement, enabled: () => boolean, onComplete: (result: RectCaptureResult | null) => void) {
    this.container = container;
    this.enabled = enabled;
    this.onComplete = onComplete;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.container.addEventListener("pointerdown", this.handlePointerDown, true);
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.container.removeEventListener("pointerdown", this.handlePointerDown, true);
    this.cancelDrag();
  }

  /** 取消当前拖拽（切换模式、Esc、视图销毁时调用） */
  cancelDrag(): void {
    const drag = this.drag;
    if (!drag) return;
    this.drag = null;
    drag.marquee.remove();
    const doc = this.container.ownerDocument;
    doc.removeEventListener("pointermove", this.handlePointerMove, true);
    doc.removeEventListener("pointerup", this.handlePointerUp, true);
    doc.removeEventListener("pointercancel", this.handlePointerCancel, true);
    doc.removeEventListener("keydown", this.handleKeyDown, true);
    try {
      if (this.container.hasPointerCapture(drag.pointerId)) this.container.releasePointerCapture(drag.pointerId);
    } catch {
      // 指针可能已经释放
    }
  }

  private handlePointerDown = (event: PointerEvent): void => {
    if (event.button !== 0 || !this.enabled() || this.drag) return;
    const target = event.target as Element | null;
    const pageEl = target?.closest?.(".page[data-page-number]") as HTMLElement | null;
    if (!pageEl || !this.container.contains(pageEl)) return;

    const page = getPageNumberOf(pageEl);
    if (!Number.isFinite(page) || page < 1) return;

    // 拦下 pdf.js 的文字选择与注释点击，让拖拽只产生矩形
    event.preventDefault();
    event.stopPropagation();

    const box = getPageContentRect(pageEl);
    const marquee = pageEl.createDiv({ cls: "pdfhl-marquee" });
    marquee.setCssStyles({ display: "none" });

    this.drag = {
      pageEl,
      page,
      box,
      startX: clamp01((event.clientX - box.left) / box.width),
      startY: clamp01((event.clientY - box.top) / box.height),
      startClientX: event.clientX,
      startClientY: event.clientY,
      pointerId: event.pointerId,
      marquee,
      rect: null,
      currentX: event.clientX,
      currentY: event.clientY,
    };

    try {
      this.container.setPointerCapture(event.pointerId);
    } catch {
      // 某些环境不支持 pointer capture，退化为依赖 document 监听
    }

    const doc = this.container.ownerDocument;
    // 用 document 级监听，保证指针离开容器后仍能继续框选
    doc.addEventListener("pointermove", this.handlePointerMove, true);
    doc.addEventListener("pointerup", this.handlePointerUp, true);
    doc.addEventListener("pointercancel", this.handlePointerCancel, true);
    doc.addEventListener("keydown", this.handleKeyDown, true);
  };

  private handlePointerMove = (event: PointerEvent): void => {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.preventDefault();
    drag.currentX = event.clientX;
    drag.currentY = event.clientY;

    const curX = clamp01((event.clientX - drag.box.left) / drag.box.width);
    const curY = clamp01((event.clientY - drag.box.top) / drag.box.height);
    const rect = rectFromPoints(drag.startX, drag.startY, curX, curY);
    drag.rect = rect;

    const style = toPercentStyle(rect);
    drag.marquee.setCssStyles({
      display: "block",
      left: style.left,
      top: style.top,
      width: style.width,
      height: style.height,
    });
  };

  private handlePointerUp = (event: PointerEvent): void => {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.preventDefault();

    const movedX = Math.abs(event.clientX - drag.startClientX);
    const movedY = Math.abs(event.clientY - drag.startClientY);
    const rect = drag.rect;
    const page = drag.page;
    const anchor = {
      left: Math.min(drag.startClientX, event.clientX),
      top: Math.min(drag.startClientY, event.clientY),
      right: Math.max(drag.startClientX, event.clientX),
      bottom: Math.max(drag.startClientY, event.clientY),
    };

    this.cancelDrag();

    if (!rect || movedX < MIN_DRAG_PIXELS || movedY < MIN_DRAG_PIXELS || !isUsableRect(rect, MIN_DRAG_SIZE)) {
      this.onComplete(null);
      return;
    }
    this.onComplete({ page, rect, anchor });
  };

  private handlePointerCancel = (): void => {
    this.cancelDrag();
    this.onComplete(null);
  };

  private handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    this.cancelDrag();
    this.onComplete(null);
  };
}
