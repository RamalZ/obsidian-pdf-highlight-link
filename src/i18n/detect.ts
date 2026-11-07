import * as Obsidian from "obsidian";
import { normalizeLocale, type Locale } from "./strings.ts";

/**
 * 读取 Obsidian 当前界面语言。
 * 1.8.7+ 提供 getLanguage()；旧版本或测试环境回退到 localStorage / navigator。
 */
function readObsidianLanguage(): string | null {
  try {
    const api = Obsidian as unknown as { getLanguage?: () => string };
    if (typeof api.getLanguage === "function") {
      const value = api.getLanguage();
      if (typeof value === "string" && value.trim()) return value;
    }
  } catch (error) {
    console.debug("[pdfhl] 读取 Obsidian 语言失败，改用回退方案", error);
  }
  return null;
}

function readStoredLanguage(): string | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const value = localStorage.getItem("language");
    if (value && value.trim()) return value;
  } catch {
    // 隐私模式/受限环境可能禁用 localStorage
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
  return normalizeLocale(
    readObsidianLanguage() ?? readStoredLanguage() ?? readNavigatorLanguage() ?? "en",
  );
}
