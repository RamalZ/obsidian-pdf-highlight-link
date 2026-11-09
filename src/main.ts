import { MarkdownView, Notice, Plugin, TFile } from "obsidian";
import type { WorkspaceLeaf } from "obsidian";
import { HighlightPanelView, VIEW_TYPE_PDF_HIGHLIGHT_PANEL } from "./panel/highlight-panel-view.ts";
import { detectLocale } from "./i18n/detect.ts";
import { getStrings, setLocale } from "./i18n/strings.ts";
import { DEFAULT_SETTINGS, normalizeSettings, PdfHighlightSettingTab, SETTINGS_SCHEMA_VERSION } from "./settings/settings-tab.ts";
import type { ActiveMode, BvLike, HighlightColor, HighlightEntry, HighlightMode, PdfHighlightSettings } from "./types.ts";
import { describeViewer, restoreApplySubpathPatch } from "./viewer/pdf-viewer-api.ts";
import { ViewerManager } from "./viewer/viewer-manager.ts";

/** 各颜色对应的实际色值（半透明由渲染器单独设置） */
const COLOR_HEX: Record<HighlightColor, string> = {
  yellow: "#ffd60a",
  green: "#4ade80",
  blue: "#60a5fa",
  pink: "#f472b6",
};

/** 索引刷新去抖（毫秒） */
const DATA_REFRESH_DELAY_MS = 200;
/** 面板刷新去抖（毫秒） */
const PANEL_REFRESH_DELAY_MS = 120;

/** 从磁盘数据里读取设置 schema 版本；非法/缺失按 1 处理（触发迁移） */
function readSchemaVersion(raw: unknown): number {
  if (raw && typeof raw === "object" && "schemaVersion" in raw) {
    const value = (raw as { schemaVersion?: unknown }).schemaVersion;
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return 1;
}

export default class PdfHighlightLinkPlugin extends Plugin {
  settings: PdfHighlightSettings = { ...DEFAULT_SETTINGS };

  /** 当前会话的交互模式（默认取设置；不写盘） */
  private mode: ActiveMode = DEFAULT_SETTINGS.defaultMode;
  private viewerManager = new ViewerManager(this);
  private dataRefreshTimer: number | null = null;
  private panelRefreshTimer: number | null = null;

  async onload(): Promise<void> {
    // 必须在任何 UI 文案生成前完成：命令、ribbon、面板、设置都从这里取语言
    setLocale(detectLocale());
    const strings = getStrings();
    await this.loadSettings();
    this.mode = this.settings.defaultMode;

    this.registerView(VIEW_TYPE_PDF_HIGHLIGHT_PANEL, (leaf) => new HighlightPanelView(leaf, this));

    this.addRibbonIcon("highlighter", strings.ribbonOpenPanel, () => {
      void this.activatePanel();
    });

    this.addCommand({
      id: "open-highlight-panel",
      name: strings.commandOpenPanel,
      callback: () => {
        void this.activatePanel();
      },
    });
    this.addCommand({
      id: "refresh-highlights",
      name: strings.commandRefresh,
      callback: () => {
        this.viewerManager.refreshAll();
        new Notice(getStrings().noticeRefreshed);
      },
    });
    this.addCommand({
      id: "diagnose-pdf-viewer",
      name: strings.commandDiagnose,
      callback: () => this.diagnoseViewer(),
    });

    this.addSettingTab(new PdfHighlightSettingTab(this.app, this));

    // 先建立 PDF 视图绑定，再监听元数据变化
    this.viewerManager.register();
    this.registerEvent(this.app.metadataCache.on("changed", () => this.scheduleDataRefresh()));
    this.registerEvent(this.app.metadataCache.on("deleted", () => this.scheduleDataRefresh()));
    this.registerEvent(this.app.vault.on("rename", () => this.scheduleDataRefresh()));
    this.registerEvent(this.app.vault.on("delete", () => this.scheduleDataRefresh()));

    // 布局恢复完成后再扫一次，覆盖启动时已经打开的 PDF
    this.app.workspace.onLayoutReady(() => this.viewerManager.rescan());
  }

  onunload(): void {
    if (this.dataRefreshTimer !== null) window.clearTimeout(this.dataRefreshTimer);
    if (this.panelRefreshTimer !== null) window.clearTimeout(this.panelRefreshTimer);
    this.dataRefreshTimer = null;
    this.panelRefreshTimer = null;
    this.viewerManager.destroyAll();
    restoreApplySubpathPatch();
  }

  // -------------------------------------------------------------------------
  // 设置
  // -------------------------------------------------------------------------

  async loadSettings(): Promise<void> {
    const raw: unknown = await this.loadData();
    this.settings = normalizeSettings(raw);
    // 旧版本数据缺少 schemaVersion：迁移结果（默认无模式）落盘一次
    const storedVersion = readSchemaVersion(raw);
    if (storedVersion < SETTINGS_SCHEMA_VERSION) await this.saveSettings();
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  // -------------------------------------------------------------------------
  // 模式 / 样式（供工具栏、快捷键、设置页调用）
  // -------------------------------------------------------------------------

  getMode(): ActiveMode {
    return this.mode;
  }

  setMode(mode: ActiveMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.viewerManager.applyModeAll();
  }

  /** 工具栏按钮/快捷键的语义：点已激活的模式 → 回到无模式，否则切到该模式 */
  toggleMode(mode: HighlightMode): void {
    this.setMode(this.mode === mode ? "none" : mode);
  }

  /** 链接生成用的来源路径（与 Obsidian 原生复制 PDF 链接保持一致，留空） */
  getSourcePath(): string {
    return "";
  }

  getColorHex(): string {
    return COLOR_HEX[this.settings.color] ?? COLOR_HEX.yellow;
  }

  applyStyle(): void {
    this.viewerManager.applyStyleAll();
  }

  getViewerManager(): ViewerManager {
    return this.viewerManager;
  }

  // -------------------------------------------------------------------------
  // 面板：跳转到来源笔记
  // -------------------------------------------------------------------------

  /** 打开高亮所在的笔记，并把视图定位到那一行链接 */
  async openSourceNote(entry: HighlightEntry): Promise<void> {
    const strings = getStrings();
    const file = this.app.vault.getAbstractFileByPath(entry.sourcePath);
    if (!(file instanceof TFile)) {
      new Notice(strings.noticeSourceNotFound(entry.sourcePath));
      return;
    }

    // 已经打开就直接切过去，否则在新标签页里打开，避免把当前 PDF 标签页顶掉
    const opened = this.app.workspace
      .getLeavesOfType("markdown")
      .find((item) => (item.view as MarkdownView).file?.path === entry.sourcePath);
    let leaf: WorkspaceLeaf;
    if (opened) {
      leaf = opened;
      try {
        await this.app.workspace.revealLeaf(opened);
      } catch (error) {
        console.debug("[pdfhl] 切换到已打开的笔记失败（已忽略）", error);
      }
      // 阅读模式下没有 editor，用临时状态让 MarkdownView 滚到那一行
      try {
        leaf.setEphemeralState({ line: Math.max(0, entry.line) });
      } catch (error) {
        console.debug("[pdfhl] 定位已打开的笔记失败（已忽略）", error);
      }
    } else {
      leaf = this.app.workspace.getLeaf("tab");
      try {
        await leaf.openFile(file, { eState: { line: Math.max(0, entry.line) } });
      } catch (error) {
        console.error("[pdfhl] 打开来源笔记失败", error);
        new Notice(strings.noticeOpenSourceFailed);
        return;
      }
    }

    // 阅读模式下没有 editor，openFile 的 eState.line 已足够；编辑模式下再精确定位
    const view = leaf.view;
    if (view instanceof MarkdownView && view.editor) {
      const line = Math.min(Math.max(0, entry.line), Math.max(0, view.editor.lineCount() - 1));
      view.editor.setCursor({ line, ch: 0 });
      view.editor.scrollIntoView({ from: { line, ch: 0 }, to: { line, ch: 0 } }, true);
    }
  }

  // -------------------------------------------------------------------------
  // 诊断
  // -------------------------------------------------------------------------

  /**
   * 把内部 PDF 组件的真实结构打到控制台，用于排查「拿到的 BV 不完整」。
   * 不依赖调试器，用户点一次命令即可回报结果。
   */
  private diagnoseViewer(): void {
    const strings = getStrings();
    const leaves = this.app.workspace.getLeavesOfType("pdf");
    const embedBindings = this.viewerManager.getEmbedBindings();
    const appVersion = (this.app as unknown as { appVersion?: string }).appVersion ?? "unknown";
    if (leaves.length === 0 && embedBindings.length === 0) {
      new Notice(strings.noticeNoPdfView);
      return;
    }

    console.debug(strings.diagnoseTitle(appVersion, leaves.length, embedBindings.length));
    for (const leaf of leaves) {
      const raw = (leaf.view as unknown as { viewer?: unknown }).viewer;
      const wrapper = raw as { child?: unknown } | null;
      const child = wrapper?.child ?? raw;
      console.debug("叶子：", leaf, "原始 viewer：", raw);
      if (child) {
        console.debug("内部组件结构：", describeViewer(child as BvLike));
      } else {
        console.debug("内部组件尚未创建（viewer 为空）");
      }
      const binding = this.viewerManager.getBindings().find((item) => item.leaf === leaf);
      console.debug(
        "绑定状态：",
        binding
          ? {
              alive: binding.isAlive(),
              entries: binding.getEntries().length,
              file: binding.getPdfFile()?.path ?? null,
            }
          : "无绑定",
      );
    }

    if (embedBindings.length === 0) {
      console.debug(strings.diagnoseNoEmbed);
    } else {
      for (const [index, binding] of embedBindings.entries()) {
        console.debug(`内嵌 #${index + 1}：`, binding.getHostInfo());
        console.debug(
          "绑定状态：",
          {
            alive: binding.isAlive(),
            entries: binding.getEntries().length,
            file: binding.getPdfFile()?.path ?? null,
          },
        );
      }
    }
    new Notice(strings.noticeDiagnostics);
  }

  // -------------------------------------------------------------------------
  // 数据刷新
  // -------------------------------------------------------------------------

  /** 视图绑定重建索引后调用：去抖刷新面板 */
  notifyDataChanged(): void {
    if (this.panelRefreshTimer !== null) window.clearTimeout(this.panelRefreshTimer);
    this.panelRefreshTimer = window.setTimeout(() => {
      this.panelRefreshTimer = null;
      this.refreshPanelViews();
    }, PANEL_REFRESH_DELAY_MS);
  }

  private scheduleDataRefresh(): void {
    if (this.dataRefreshTimer !== null) window.clearTimeout(this.dataRefreshTimer);
    this.dataRefreshTimer = window.setTimeout(() => {
      this.dataRefreshTimer = null;
      this.viewerManager.refreshAll();
      this.refreshPanelViews();
    }, DATA_REFRESH_DELAY_MS);
  }

  refreshPanelViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_PDF_HIGHLIGHT_PANEL)) {
      const view = leaf.view;
      if (view instanceof HighlightPanelView) view.refresh();
    }
  }

  // -------------------------------------------------------------------------
  // 面板
  // -------------------------------------------------------------------------

  async activatePanel(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_PDF_HIGHLIGHT_PANEL)[0];
    if (existing) {
      try {
        await this.app.workspace.revealLeaf(existing);
      } catch (error) {
        console.debug("[pdfhl] 展开右侧面板失败（已忽略）", error);
      }
      return;
    }
    const leaf: WorkspaceLeaf | null = this.app.workspace.getRightLeaf(false);
    if (!leaf) {
      new Notice(getStrings().noticeNoRightPanel);
      return;
    }
    await leaf.setViewState({ type: VIEW_TYPE_PDF_HIGHLIGHT_PANEL, active: true });
    try {
      await this.app.workspace.revealLeaf(leaf);
    } catch (error) {
      console.debug("[pdfhl] 展开右侧面板失败（已忽略）", error);
    }
    const view = leaf.view;
    if (view instanceof HighlightPanelView) view.refresh();
  }
}
