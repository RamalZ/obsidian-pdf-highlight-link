import type { HighlightMode } from "../types.ts";

/** 插件支持的语言。其他语言统一回退到英文。 */
export type Locale = "zh" | "zh-TW" | "en";

/** 所有 UI 文案与参数化文案的集中定义（纯模块，不依赖 Obsidian）。 */
export interface I18nStrings {
  readonly locale: Locale;

  readonly ribbonOpenPanel: string;
  readonly commandOpenPanel: string;
  readonly commandRefresh: string;
  readonly commandDiagnose: string;

  readonly noticeRefreshed: string;
  readonly noticeCopiedReference: string;
  readonly noticeCopiedLink: string;
  readonly noticeCopyFailed: string;
  readonly noticePdfFileMissing: string;
  readonly noticeSourceNotFound: (sourcePath: string) => string;
  readonly noticeOpenSourceFailed: string;
  readonly noticeNoPdfView: string;
  readonly noticeDiagnostics: string;
  readonly noticeNoRightPanel: string;

  readonly modeTextLabel: string;
  readonly modeRectLabel: string;
  readonly modeNoneName: string;
  readonly modeTextName: string;
  readonly modeRectName: string;

  readonly floatCopyReference: string;
  readonly floatCopyLink: string;
  readonly floatCancel: string;

  readonly panelTitle: string;
  readonly panelRefreshAria: string;
  readonly panelSearchPlaceholder: string;
  readonly panelNoPdf: string;
  readonly panelCount: (count: number) => string;
  readonly panelEmptyNoPdf: string;
  readonly panelEmptyNoHighlights: string;
  readonly panelEmptyNoMatch: string;
  readonly panelPageGroup: (page: number) => string;
  readonly panelGroupCount: (count: number) => string;
  readonly panelPageTitle: (page: number, snippet: string) => string;
  readonly panelKindText: string;
  readonly panelKindRect: string;
  readonly panelSourceAria: (sourcePath: string) => string;

  readonly settingDefaultModeName: string;
  readonly settingDefaultModeDesc: string;
  readonly settingColorName: string;
  readonly settingColorDesc: string;
  readonly settingOpacityName: string;
  readonly settingOpacityDesc: string;
  readonly settingRestoreName: string;
  readonly settingRestoreDesc: string;
  readonly settingRestoreButton: string;

  readonly colorYellow: string;
  readonly colorGreen: string;
  readonly colorBlue: string;
  readonly colorPink: string;

  readonly aliasForPage: (fileName: string, page: number) => string;
  readonly aliasForKind: (kind: HighlightMode) => string;
  readonly snippetFallback: (kind: HighlightMode) => string;
  readonly referencePlaceholder: string;
  readonly nativeAliasPatterns: readonly RegExp[];

  readonly diagnoseTitle: (appVersion: string, leafCount: number, embedCount: number) => string;
  readonly diagnoseNoEmbed: string;
}

/**
 * 所有语言的原生 PDF 别名模式。
 * 注意：始终同时识别三套语言，避免用户切换语言后旧链接的引用行取不回来。
 */
const ALL_NATIVE_ALIAS_PATTERNS: readonly RegExp[] = [
  /^\S+\.\w{1,5}, 第 \d+ 页$/,
  /^\S+\.\w{1,5}, 第 \d+ 頁$/,
  /^\S+\.\w{1,5}, page \d+$/i,
];

const ZH: I18nStrings = {
  locale: "zh",
  ribbonOpenPanel: "打开 PDF 高亮面板",
  commandOpenPanel: "打开高亮面板",
  commandRefresh: "刷新高亮",
  commandDiagnose: "诊断 PDF 视图（输出到控制台）",

  noticeRefreshed: "已刷新 PDF 高亮",
  noticeCopiedReference: "已复制引用块，粘贴到笔记即可",
  noticeCopiedLink: "已复制 PDF 高亮链接，粘贴到笔记即可",
  noticeCopyFailed: "复制失败，请检查剪贴板权限",
  noticePdfFileMissing: "未能识别当前 PDF 文件，链接复制失败",
  noticeSourceNotFound: (sourcePath) => `找不到来源笔记：${sourcePath}`,
  noticeOpenSourceFailed: "打开来源笔记失败",
  noticeNoPdfView: "当前没有打开的 PDF 视图",
  noticeDiagnostics: "诊断信息已输出到开发者控制台（Ctrl+Shift+I）",
  noticeNoRightPanel: "无法打开右侧面板，请稍后重试",

  modeTextLabel: "文字模式：选中文字后复制链接；再点一次退出到无模式",
  modeRectLabel: "框选模式：拖拽矩形后复制链接；再点一次退出到无模式",
  modeNoneName: "无模式（正常浏览）",
  modeTextName: "文字模式",
  modeRectName: "框选模式",

  floatCopyReference: "复制引用",
  floatCopyLink: "复制链接",
  floatCancel: "取消",

  panelTitle: "PDF 高亮",
  panelRefreshAria: "刷新高亮",
  panelSearchPlaceholder: "搜索高亮内容或页码…",
  panelNoPdf: "未检测到打开的 PDF",
  panelCount: (count) => `${count} 条高亮`,
  panelEmptyNoPdf: "打开一个 PDF 文件后，这里会按页列出它的高亮。",
  panelEmptyNoHighlights: "还没有高亮。在 PDF 里选中文字或框选区域，复制链接并粘贴到笔记即可。",
  panelEmptyNoMatch: "没有匹配的高亮。",
  panelPageGroup: (page) => `第 ${page} 页`,
  panelGroupCount: (count) => `${count} 条`,
  panelPageTitle: (page, snippet) => `${page} 页 · ${snippet}`,
  panelKindText: "文字",
  panelKindRect: "区域",
  panelSourceAria: (sourcePath) => `打开来源笔记：${sourcePath}`,

  settingDefaultModeName: "默认模式",
  settingDefaultModeDesc:
    "打开 PDF 时的初始模式。默认「无模式」不干预鼠标；在 PDF 工具栏点按钮或按 T 键可随时切换。",
  settingColorName: "高亮颜色",
  settingColorDesc: "所有 PDF 高亮统一使用这一颜色（不写进链接，可随时改）。",
  settingOpacityName: "高亮透明度",
  settingOpacityDesc: "0.1 – 0.8，默认 0.35。只影响显示，不改变链接。",
  settingRestoreName: "恢复默认设置",
  settingRestoreDesc: "把默认模式、颜色、透明度恢复为初始值。",
  settingRestoreButton: "恢复默认",

  colorYellow: "黄色",
  colorGreen: "绿色",
  colorBlue: "蓝色",
  colorPink: "粉色",

  aliasForPage: (fileName, page) => `${fileName}, 第 ${page} 页`,
  aliasForKind: (kind) => (kind === "text" ? "文字高亮" : "区域批注"),
  snippetFallback: (kind) => (kind === "text" ? "文字高亮" : "区域批注"),
  referencePlaceholder: "（此处由使用者根据区域内容自行填写）",
  nativeAliasPatterns: ALL_NATIVE_ALIAS_PATTERNS,

  diagnoseTitle: (appVersion, leafCount, embedCount) =>
    `[pdfhl] PDF 视图诊断（Obsidian ${appVersion}，${leafCount} 个叶子，${embedCount} 个内嵌）`,
  diagnoseNoEmbed: "内嵌 PDF 绑定：无",
};

const ZH_TW: I18nStrings = {
  locale: "zh-TW",
  ribbonOpenPanel: "開啟 PDF 醒目提示面板",
  commandOpenPanel: "開啟醒目提示面板",
  commandRefresh: "重新整理醒目提示",
  commandDiagnose: "診斷 PDF 檢視（輸出到主控台）",

  noticeRefreshed: "已重新整理 PDF 醒目提示",
  noticeCopiedReference: "已複製引用區塊，貼到筆記即可",
  noticeCopiedLink: "已複製 PDF 醒目提示連結，貼到筆記即可",
  noticeCopyFailed: "複製失敗，請檢查剪貼簿權限",
  noticePdfFileMissing: "無法辨識目前的 PDF 檔案，連結複製失敗",
  noticeSourceNotFound: (sourcePath) => `找不到來源筆記：${sourcePath}`,
  noticeOpenSourceFailed: "開啟來源筆記失敗",
  noticeNoPdfView: "目前沒有開啟的 PDF 檢視",
  noticeDiagnostics: "診斷資訊已輸出到開發者主控台（Ctrl+Shift+I）",
  noticeNoRightPanel: "無法開啟右側面板，請稍後再試",

  modeTextLabel: "文字模式：選取文字後複製連結；再按一次退出至無模式",
  modeRectLabel: "框選模式：拖曳矩形後複製連結；再按一次退出至無模式",
  modeNoneName: "無模式（正常瀏覽）",
  modeTextName: "文字模式",
  modeRectName: "框選模式",

  floatCopyReference: "複製引用",
  floatCopyLink: "複製連結",
  floatCancel: "取消",

  panelTitle: "PDF 醒目提示",
  panelRefreshAria: "重新整理醒目提示",
  panelSearchPlaceholder: "搜尋醒目提示內容或頁碼…",
  panelNoPdf: "未偵測到開啟的 PDF",
  panelCount: (count) => `${count} 則醒目提示`,
  panelEmptyNoPdf: "開啟 PDF 檔案後，這裡會依頁列出它的醒目提示。",
  panelEmptyNoHighlights: "還沒有醒目提示。在 PDF 中選取文字或框選區域，複製連結並貼到筆記即可。",
  panelEmptyNoMatch: "沒有符合的醒目提示。",
  panelPageGroup: (page) => `第 ${page} 頁`,
  panelGroupCount: (count) => `${count} 則`,
  panelPageTitle: (page, snippet) => `${page} 頁 · ${snippet}`,
  panelKindText: "文字",
  panelKindRect: "區域",
  panelSourceAria: (sourcePath) => `開啟來源筆記：${sourcePath}`,

  settingDefaultModeName: "預設模式",
  settingDefaultModeDesc:
    "開啟 PDF 時的初始模式。預設「無模式」不干預滑鼠；可在 PDF 工具列按按鈕或按 T 鍵隨時切換。",
  settingColorName: "醒目提示顏色",
  settingColorDesc: "所有 PDF 醒目提示統一使用這個顏色（不寫進連結，可隨時變更）。",
  settingOpacityName: "醒目提示透明度",
  settingOpacityDesc: "0.1 – 0.8，預設 0.35。只影響顯示，不改變連結。",
  settingRestoreName: "還原預設設定",
  settingRestoreDesc: "把預設模式、顏色、透明度還原為初始值。",
  settingRestoreButton: "還原預設",

  colorYellow: "黃色",
  colorGreen: "綠色",
  colorBlue: "藍色",
  colorPink: "粉紅色",

  aliasForPage: (fileName, page) => `${fileName}, 第 ${page} 頁`,
  aliasForKind: (kind) => (kind === "text" ? "文字醒目提示" : "區域註記"),
  snippetFallback: (kind) => (kind === "text" ? "文字醒目提示" : "區域註記"),
  referencePlaceholder: "（此處由使用者依區域內容自行填寫）",
  nativeAliasPatterns: ALL_NATIVE_ALIAS_PATTERNS,

  diagnoseTitle: (appVersion, leafCount, embedCount) =>
    `[pdfhl] PDF 檢視診斷（Obsidian ${appVersion}，${leafCount} 個葉子，${embedCount} 個內嵌）`,
  diagnoseNoEmbed: "內嵌 PDF 綁定：無",
};

const EN: I18nStrings = {
  locale: "en",
  ribbonOpenPanel: "Open PDF highlights panel",
  commandOpenPanel: "Open highlights panel",
  commandRefresh: "Refresh highlights",
  commandDiagnose: "Diagnose PDF viewer (log to console)",

  noticeRefreshed: "PDF highlights refreshed",
  noticeCopiedReference: "Quote block copied; paste it into a note",
  noticeCopiedLink: "PDF highlight link copied; paste it into a note",
  noticeCopyFailed: "Copy failed. Check clipboard permissions.",
  noticePdfFileMissing: "Could not identify the current PDF; link copy failed.",
  noticeSourceNotFound: (sourcePath) => `Source note not found: ${sourcePath}`,
  noticeOpenSourceFailed: "Failed to open the source note",
  noticeNoPdfView: "No PDF view is open",
  noticeDiagnostics: "Diagnostics written to the developer console (Ctrl+Shift+I)",
  noticeNoRightPanel: "Could not open the right panel. Try again.",

  modeTextLabel: "Text mode: select text to copy a link; click again to exit to no mode",
  modeRectLabel: "Rect mode: drag a rectangle to copy a link; click again to exit to no mode",
  modeNoneName: "No mode (normal browsing)",
  modeTextName: "Text mode",
  modeRectName: "Rect mode",

  floatCopyReference: "Copy quote",
  floatCopyLink: "Copy link",
  floatCancel: "Cancel",

  panelTitle: "PDF highlights",
  panelRefreshAria: "Refresh highlights",
  panelSearchPlaceholder: "Search highlights or page number…",
  panelNoPdf: "No PDF open",
  panelCount: (count) => (count === 1 ? "1 highlight" : `${count} highlights`),
  panelEmptyNoPdf: "Open a PDF file to list its highlights by page.",
  panelEmptyNoHighlights:
    "No highlights yet. Select text or drag a rectangle in the PDF, copy the link, and paste it into a note.",
  panelEmptyNoMatch: "No matching highlights.",
  panelPageGroup: (page) => `page ${page}`,
  panelGroupCount: (count) => (count === 1 ? "1 item" : `${count} items`),
  panelPageTitle: (page, snippet) => `page ${page} · ${snippet}`,
  panelKindText: "Text",
  panelKindRect: "Region",
  panelSourceAria: (sourcePath) => `Open source note: ${sourcePath}`,

  settingDefaultModeName: "Default mode",
  settingDefaultModeDesc:
    "Initial mode when a PDF opens. “No mode” leaves the mouse alone; use the PDF toolbar buttons or press T to switch at any time.",
  settingColorName: "Highlight color",
  settingColorDesc: "All PDF highlights use this color (not stored in links; change it anytime).",
  settingOpacityName: "Highlight opacity",
  settingOpacityDesc: "0.1 – 0.8, default 0.35. Display only; links are unchanged.",
  settingRestoreName: "Restore defaults",
  settingRestoreDesc: "Reset the default mode, color, and opacity.",
  settingRestoreButton: "Restore defaults",

  colorYellow: "Yellow",
  colorGreen: "Green",
  colorBlue: "Blue",
  colorPink: "Pink",

  aliasForPage: (fileName, page) => `${fileName}, page ${page}`,
  aliasForKind: (kind) => (kind === "text" ? "Text highlight" : "Region note"),
  snippetFallback: (kind) => (kind === "text" ? "Text highlight" : "Region note"),
  referencePlaceholder: "(Describe the region content here)",
  nativeAliasPatterns: ALL_NATIVE_ALIAS_PATTERNS,

  diagnoseTitle: (appVersion, leafCount, embedCount) =>
    `[pdfhl] PDF viewer diagnostics (Obsidian ${appVersion}, ${leafCount} leaves, ${embedCount} embeds)`,
  diagnoseNoEmbed: "Embedded PDF bindings: none",
};

const TABLES: Record<Locale, I18nStrings> = {
  zh: ZH,
  "zh-TW": ZH_TW,
  en: EN,
};

/** 把任意语言代码归一到插件支持的三种语言；未知语言回退英文。 */
export function normalizeLocale(input: string | null | undefined): Locale {
  const raw = (input ?? "").trim().toLowerCase();
  if (!raw) return "en";
  if (raw.startsWith("zh")) {
    // 兼容 zh-Hant-TW、zh-Hans-CN 这类带文字/地区的完整 BCP 47 标签。
    if (raw.includes("hant") || raw.includes("-tw") || raw.includes("-hk") || raw.includes("-mo")) {
      return "zh-TW";
    }
    return "zh";
  }
  return "en";
}

let currentLocale: Locale = "zh";

/** 设置当前语言（默认简体中文，保证未初始化时与旧版本行为一致）。 */
export function setLocale(locale: string): void {
  currentLocale = normalizeLocale(locale);
}

/** 当前语言的文案表。 */
export function getStrings(): I18nStrings {
  return TABLES[currentLocale];
}
