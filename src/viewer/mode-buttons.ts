import { setIcon } from "obsidian";
import type { ActiveMode, HighlightMode } from "../types.ts";

export interface ModeButtonsHandle {
  /** 更新两个按钮的激活态（none 时两个都不激活） */
  setMode(mode: ActiveMode): void;
  /** 工具栏重建后按钮是否仍挂在同一容器里 */
  isAttached(): boolean;
  destroy(): void;
}

interface ButtonSpec {
  mode: HighlightMode;
  icon: string;
  label: string;
}

const BUTTONS: ButtonSpec[] = [
  { mode: "text", icon: "type", label: "文字模式：选中文字后复制链接；再点一次退出到无模式" },
  { mode: "rect", icon: "scan", label: "框选模式：拖拽矩形后复制链接；再点一次退出到无模式" },
];

/**
 * 在 PDF 工具栏右侧创建模式切换按钮（三态：无模式 / 文字 / 框选）。
 * 点击当前已激活的按钮表示退出到「无模式」，由调用方通过 setMode 反映最终状态。
 * 容器由 Obsidian 传入（toolbarRightEl）；工具栏重建时调用方会重新创建。
 */
export function createModeButtons(
  toolbarRightEl: HTMLElement,
  initialMode: ActiveMode,
  onSelect: (mode: HighlightMode) => void,
): ModeButtonsHandle {
  const created: HTMLElement[] = [];

  // 与内置按钮保持一致的分隔间距
  const spacer = toolbarRightEl.createDiv({ cls: "pdf-toolbar-spacer" });
  created.push(spacer);

  const buttons = new Map<HighlightMode, HTMLElement>();

  for (const spec of BUTTONS) {
    const button = toolbarRightEl.createDiv({ cls: "clickable-icon pdfhl-mode-btn" });
    button.setAttribute("aria-label", spec.label);
    button.setAttribute("data-tooltip-position", "bottom");
    button.tabIndex = 0;
    button.dataset.mode = spec.mode;
    setIcon(button, spec.icon);

    const activate = (event: Event) => {
      event.preventDefault();
      // 点击只上报「想切换到哪个模式」，是否切换（含再点一次退出）由插件决定
      onSelect(spec.mode);
    };
    button.addEventListener("click", activate);
    button.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") activate(event);
    });

    buttons.set(spec.mode, button);
    created.push(button);
  }

  const applyMode = (mode: ActiveMode) => {
    for (const [buttonMode, button] of buttons) {
      button.toggleClass("is-active", buttonMode === mode);
    }
  };
  applyMode(initialMode);

  return {
    setMode: applyMode,
    isAttached: () => created.every((element) => element.isConnected && element.parentElement === toolbarRightEl),
    destroy: () => {
      for (const element of created) element.remove();
      created.length = 0;
      buttons.clear();
    },
  };
}
