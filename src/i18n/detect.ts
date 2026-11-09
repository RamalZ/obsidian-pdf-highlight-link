import { getLanguage } from "obsidian";
import { normalizeLocale, type Locale } from "./strings.ts";

/**
 * 读取 Obsidian 当前界面语言。
 * 1.13.0+ 直接使用 getLanguage()；测试环境或异常时回退到 navigator。
 */
function readObsidianLanguage(): string | null {
  try {
    const value = getLanguage();
    if (typeof value === "string" && value.trim()) return value;
  } catch (error) {
    console.debug("[pdfhl] 读取 Obsidian 语言失败，改用回退方案", error);
  }
  return null;
}

function readNavigatorLanguage(): string | null {
  try {
    if (typeof navigator !== "undefined" && navigator.language) return navigator.language;
  } catch {
    // 忽略
  }
  return null;
}

/** 探测当前界面语言并归一为插件支持的语言。 */
export function detectLocale(): Locale {
  return normalizeLocale(readObsidianLanguage() ?? readNavigatorLanguage() ?? "en");
}
