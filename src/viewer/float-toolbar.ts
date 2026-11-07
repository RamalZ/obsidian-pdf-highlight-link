import { setIcon } from "obsidian";

export interface FloatToolbarHandlers {
  /** 复制「引用块」（callout + 链接） */
  onCopyReference(): void;
  /** 只复制纯链接 */
  onCopyLink(): void;
  onCancel(): void;
}

/**
 * 浮动工具栏：固定在选区附近，从左到右依次是「复制引用」「复制链接」「取消」。
 * 注意：按钮的 mousedown 必须 preventDefault，否则点击会丢掉 PDF 的文字选区。
 */
export class FloatToolbar {
  private doc: Document;
  private el: HTMLElement;
  private referenceButton: HTMLButtonElement;
  private copyButton: HTMLButtonElement;
  private cancelButton: HTMLButtonElement;
  private handlers: FloatToolbarHandlers;
  private visible = false;

  constructor(doc: Document, handlers: FloatToolbarHandlers) {
    this.doc = doc;
    this.handlers = handlers;

    this.el = doc.createElement("div");
    this.el.className = "pdfhl-float-toolbar";
    this.el.addEventListener("mousedown", (event) => event.preventDefault());

    this.referenceButton = this.createButton("quote", "复制引用", "pdfhl-float-quote");
    this.referenceButton.addEventListener("click", (event) => {
      event.preventDefault();
      this.handlers.onCopyReference();
    });

    this.copyButton = this.createButton("link", "复制链接", "pdfhl-float-copy");
    this.copyButton.addEventListener("click", (event) => {
      event.preventDefault();
      this.handlers.onCopyLink();
    });

    this.cancelButton = this.createButton("x", "取消", "pdfhl-float-cancel");
    this.cancelButton.addEventListener("click", (event) => {
      event.preventDefault();
      this.hide();
      this.handlers.onCancel();
    });

    doc.body.appendChild(this.el);
  }

  private createButton(icon: string, label: string, extraClass: string): HTMLButtonElement {
    const button = this.doc.createElement("button");
    button.type = "button";
    button.className = `pdfhl-float-btn ${extraClass}`;
    button.setAttribute("aria-label", label);
    // 图标 + 文字：图标由 Obsidian 的 setIcon 注入，文字便于首次使用时理解
    const iconEl = this.doc.createElement("span");
    iconEl.className = "pdfhl-float-icon";
    setIcon(iconEl, icon);
    const textEl = this.doc.createElement("span");
    textEl.textContent = label;
    button.appendChild(iconEl);
    button.appendChild(textEl);
    this.el.appendChild(button);
    return button;
  }

  isVisible(): boolean {
    return this.visible;
  }

  /** 显示在锚点（通常是被选中文字的外接矩形）下方，必要时翻到上方并夹进视口 */
  showAt(anchor: { left: number; top: number; right: number; bottom: number }): void {
    this.visible = true;
    this.el.style.display = "flex";
    this.el.style.visibility = "hidden";

    const view = this.doc.defaultView ?? window;
    const mouseX = (anchor.left + anchor.right) / 2;
    const rect = this.el.getBoundingClientRect();
    const margin = 8;
    let left = mouseX - rect.width / 2;
    let top = anchor.bottom + margin;
    if (top + rect.height > view.innerHeight - margin) top = anchor.top - rect.height - margin;
    left = Math.max(margin, Math.min(left, view.innerWidth - rect.width - margin));
    top = Math.max(margin, Math.min(top, view.innerHeight - rect.height - margin));

    this.el.style.left = `${Math.round(left)}px`;
    this.el.style.top = `${Math.round(top)}px`;
    this.el.style.visibility = "visible";
    // 不主动 focus：聚焦按钮可能让 PDF 里刚落下的文字选区失效，导致复制不到内容
  }

  hide(): void {
    this.visible = false;
    this.el.style.display = "none";
  }

  destroy(): void {
    this.el.remove();
  }
}
