import { ItemView, setIcon } from "obsidian";
import type { WorkspaceLeaf } from "obsidian";
import type PdfHighlightLinkPlugin from "../main.ts";
import type { HighlightEntry } from "../types.ts";
import type { TFile } from "obsidian";
import { getStrings } from "../i18n/strings.ts";
import { groupByPage, sourceDisplayName } from "../core/backlink-index.ts";
import { entrySnippet } from "../core/link.ts";
import type { ViewerBinding } from "../viewer/viewer-binding.ts";

export const VIEW_TYPE_PDF_HIGHLIGHT_PANEL = "pdfhl-highlight-panel";

/**
 * 右侧高亮面板：跟随当前 PDF，按页分组列出所有反向链接高亮。
 * 点击条目跳转到对应页码并闪烁。
 */
export class HighlightPanelView extends ItemView {
  private plugin: PdfHighlightLinkPlugin;
  private summaryEl: HTMLElement | null = null;
  private listEl: HTMLElement | null = null;
  private searchQuery = "";
  private entries: HighlightEntry[] = [];
  private file: TFile | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: PdfHighlightLinkPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_PDF_HIGHLIGHT_PANEL;
  }

  getDisplayText(): string {
    return getStrings().panelTitle;
  }

  getIcon(): string {
    return "highlighter";
  }

  async onOpen(): Promise<void> {
    const container = this.contentEl;
    const strings = getStrings();
    container.empty();
    container.addClass("pdfhl-panel");

    const header = container.createDiv({ cls: "pdfhl-panel-header" });
    const titleRow = header.createDiv({ cls: "pdfhl-panel-title-row" });
    titleRow.createDiv({ cls: "pdfhl-panel-title", text: strings.panelTitle });
    const refreshButton = titleRow.createEl("button", {
      cls: "clickable-icon",
      attr: { "aria-label": strings.panelRefreshAria },
    });
    setIcon(refreshButton, "refresh-cw");
    refreshButton.addEventListener("click", () => this.refresh(true));

    const search = header.createDiv({ cls: "pdfhl-search" });
    const searchIcon = search.createDiv({ cls: "pdfhl-search-icon" });
    setIcon(searchIcon, "search");
    const input = search.createEl("input", {
      type: "search",
      placeholder: strings.panelSearchPlaceholder,
      cls: "pdfhl-search-input",
    });
    input.addEventListener("input", () => {
      this.searchQuery = input.value.trim().toLowerCase();
      this.renderList();
    });

    this.summaryEl = container.createDiv({ cls: "pdfhl-panel-summary" });
    this.listEl = container.createDiv({ cls: "pdfhl-panel-list" });

    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.refresh()));
    this.registerEvent(this.app.workspace.on("layout-change", () => this.refresh()));
    this.refresh();
  }

  async onClose(): Promise<void> {
    this.contentEl.empty();
    this.summaryEl = null;
    this.listEl = null;
    this.entries = [];
    this.file = null;
  }

  /** 刷新数据与界面；force=true 时先重建索引 */
  refresh(force = false): void {
    const binding = this.plugin.getViewerManager().getActiveBinding();
    if (force) binding?.refresh();
    this.file = binding?.getPdfFile() ?? null;
    this.entries = binding?.getEntries() ?? [];
    this.renderSummary();
    this.renderList();
  }

  // -------------------------------------------------------------------------
  // 渲染
  // -------------------------------------------------------------------------

  private renderSummary(): void {
    const summary = this.summaryEl;
    if (!summary) return;
    summary.empty();
    const strings = getStrings();
    if (!this.file) {
      summary.setText(strings.panelNoPdf);
      return;
    }
    summary.createSpan({ text: this.file.basename });
    summary.createSpan({ cls: "pdfhl-panel-count", text: strings.panelCount(this.entries.length) });
  }

  private renderList(): void {
    const list = this.listEl;
    if (!list) return;
    list.empty();

    const strings = getStrings();
    if (!this.file) {
      list.createDiv({
        cls: "pdfhl-panel-empty",
        text: strings.panelEmptyNoPdf,
      });
      return;
    }

    const filtered = this.filterEntries(this.entries);
    if (this.entries.length === 0) {
      list.createDiv({
        cls: "pdfhl-panel-empty",
        text: strings.panelEmptyNoHighlights,
      });
      return;
    }
    if (filtered.length === 0) {
      list.createDiv({ cls: "pdfhl-panel-empty", text: strings.panelEmptyNoMatch });
      return;
    }

    const binding = this.plugin.getViewerManager().getActiveBinding();
    const groups = groupByPage(filtered);
    for (const group of groups) {
      const groupEl = list.createDiv({ cls: "pdfhl-panel-group" });
      const groupTitle = groupEl.createDiv({ cls: "pdfhl-panel-group-title" });
      groupTitle.createSpan({ text: strings.panelPageGroup(group.page) });
      groupTitle.createSpan({ cls: "pdfhl-panel-group-count", text: strings.panelGroupCount(group.entries.length) });

      for (const entry of group.entries) {
        this.renderItem(groupEl, entry, binding);
      }
    }
  }

  private renderItem(parent: HTMLElement, entry: HighlightEntry, binding: ViewerBinding | null): void {
    const strings = getStrings();
    const item = parent.createDiv({ cls: "pdfhl-panel-item" });
    item.dataset.entryId = entry.id;
    item.dataset.kind = entry.kind;
    item.title = strings.panelPageTitle(entry.page, entrySnippet(entry.text, entry.kind));

    const dot = item.createDiv({ cls: "pdfhl-panel-dot" });
    dot.style.backgroundColor = this.plugin.getColorHex();

    const main = item.createDiv({ cls: "pdfhl-panel-item-main" });
    const meta = main.createDiv({ cls: "pdfhl-panel-item-meta" });
    meta.createSpan({
      cls: "pdfhl-panel-kind",
      text: entry.kind === "text" ? strings.panelKindText : strings.panelKindRect,
    });
    meta.createSpan({ cls: "pdfhl-panel-page", text: strings.panelPageGroup(entry.page) });
    main.createDiv({ cls: "pdfhl-panel-snippet", text: entrySnippet(entry.text, entry.kind) });

    // 来源笔记：单独一行小链接，点击打开笔记并定位到那一行（不影响条目本身的跳页）
    const footer = main.createDiv({ cls: "pdfhl-panel-item-footer" });
    const sourceLink = footer.createEl("a", {
      cls: "pdfhl-panel-source-link",
      text: sourceDisplayName(entry.sourcePath),
      href: "#",
    });
    sourceLink.setAttribute("aria-label", strings.panelSourceAria(entry.sourcePath));
    sourceLink.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void this.plugin.openSourceNote(entry);
    });

    item.addEventListener("click", () => {
      binding?.goToEntry(entry);
      this.flashItem(item);
    });
  }

  private flashItem(item: HTMLElement): void {
    item.classList.remove("is-active");
    void item.offsetWidth;
    item.classList.add("is-active");
    window.setTimeout(() => item.classList.remove("is-active"), 600);
  }

  private filterEntries(entries: readonly HighlightEntry[]): HighlightEntry[] {
    const query = this.searchQuery;
    if (!query) return entries.slice();
    return entries.filter((entry) => {
      if (String(entry.page) === query) return true;
      if (String(entry.page).startsWith(query)) return true;
      const text = entry.text.toLowerCase();
      if (text.includes(query)) return true;
      return entry.sourcePath.toLowerCase().includes(query);
    });
  }
}
