import { PluginSettingTab } from "obsidian";
import type { App, Setting, SettingDefinitionItem } from "obsidian";
import { getStrings } from "../i18n/strings.ts";
import type PdfHighlightLinkPlugin from "../main.ts";
import type { ActiveMode, HighlightColor, PdfHighlightSettings } from "../types.ts";

/**
 * 设置数据结构版本：
 * - 1：初版（默认模式只有文字/框选，默认文字）
 * - 2：引入三态模式，默认无模式；旧数据迁移为无模式
 */
export const SETTINGS_SCHEMA_VERSION = 2;

/** 默认设置（默认无模式：不干预鼠标，想用时再点工具栏按钮） */
export const DEFAULT_SETTINGS: PdfHighlightSettings = {
  schemaVersion: SETTINGS_SCHEMA_VERSION,
  defaultMode: "none",
  color: "yellow",
  opacity: 0.35,
};

/** 交互模式选项（工具栏、设置下拉共用） */
export function getModeOptions(): Array<{ value: ActiveMode; label: string }> {
  const strings = getStrings();
  return [
    { value: "none", label: strings.modeNoneName },
    { value: "text", label: strings.modeTextName },
    { value: "rect", label: strings.modeRectName },
  ];
}

const VALID_MODES: ActiveMode[] = ["none", "text", "rect"];

/** 颜色选项（面板色点、设置下拉共用） */
export function getColorOptions(): Array<{ value: HighlightColor; label: string }> {
  const strings = getStrings();
  return [
    { value: "yellow", label: strings.colorYellow },
    { value: "green", label: strings.colorGreen },
    { value: "blue", label: strings.colorBlue },
    { value: "pink", label: strings.colorPink },
  ];
}

const VALID_COLORS: HighlightColor[] = ["yellow", "green", "blue", "pink"];

/** 把磁盘上的原始数据整理成合法设置（兼容旧版本/手改 data.json） */
export function normalizeSettings(raw: unknown): PdfHighlightSettings {
  const source = (raw ?? {}) as Partial<PdfHighlightSettings>;
  const schemaVersion = typeof source.schemaVersion === "number" ? source.schemaVersion : 1;
  const migrated = schemaVersion < SETTINGS_SCHEMA_VERSION;
  // 旧数据里的 defaultMode 是插件旧默认值（文字模式），迁移时不沿用，统一回到无模式
  const mode: ActiveMode =
    !migrated && VALID_MODES.includes(source.defaultMode as ActiveMode)
      ? (source.defaultMode as ActiveMode)
      : DEFAULT_SETTINGS.defaultMode;
  const color = VALID_COLORS.includes(source.color as HighlightColor)
    ? (source.color as HighlightColor)
    : DEFAULT_SETTINGS.color;
  const rawOpacity = typeof source.opacity === "number" ? source.opacity : DEFAULT_SETTINGS.opacity;
  const opacity = Math.min(0.8, Math.max(0.1, Math.round(rawOpacity * 100) / 100));
  return { schemaVersion: SETTINGS_SCHEMA_VERSION, defaultMode: mode, color, opacity };
}

/** 把选项数组转成声明式设置要求的 Record（兼容 ES2018，不用 Object.fromEntries） */
function toDropdownOptions(options: Array<{ value: string; label: string }>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const option of options) result[option.value] = option.label;
  return result;
}

export class PdfHighlightSettingTab extends PluginSettingTab {
  private plugin: PdfHighlightLinkPlugin;

  constructor(app: App, plugin: PdfHighlightLinkPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  /**
   * 1.13.0+ 的声明式设置：设置项会进入 Obsidian 设置搜索。
   * 本插件最低版本为 1.13.0，因此不需要再保留已弃用的 display()。
   */
  getSettingDefinitions(): SettingDefinitionItem[] {
    const strings = getStrings();
    return [
      {
        name: strings.settingDefaultModeName,
        desc: strings.settingDefaultModeDesc,
        control: {
          type: "dropdown",
          key: "defaultMode",
          options: toDropdownOptions(getModeOptions()),
          defaultValue: DEFAULT_SETTINGS.defaultMode,
        },
      },
      {
        name: strings.settingColorName,
        desc: strings.settingColorDesc,
        control: {
          type: "dropdown",
          key: "color",
          options: toDropdownOptions(getColorOptions()),
          defaultValue: DEFAULT_SETTINGS.color,
        },
      },
      {
        name: strings.settingOpacityName,
        desc: strings.settingOpacityDesc,
        control: {
          type: "slider",
          key: "opacity",
          min: 0.1,
          max: 0.8,
          step: 0.05,
          defaultValue: DEFAULT_SETTINGS.opacity,
        },
      },
      {
        name: strings.settingRestoreName,
        desc: strings.settingRestoreDesc,
        render: (setting: Setting) => {
          setting.addButton((button) => {
            button.setButtonText(strings.settingRestoreButton).onClick(() => {
              void this.restoreDefaults();
            });
          });
        },
      },
    ];
  }

  getControlValue(key: string): unknown {
    return (this.plugin.settings as unknown as Record<string, unknown>)[key];
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    if (key === "defaultMode") {
      const mode = VALID_MODES.includes(value as ActiveMode)
        ? (value as ActiveMode)
        : DEFAULT_SETTINGS.defaultMode;
      this.plugin.settings.defaultMode = mode;
      await this.plugin.saveSettings();
      this.plugin.setMode(mode);
      return;
    }

    if (key === "color") {
      const color = VALID_COLORS.includes(value as HighlightColor)
        ? (value as HighlightColor)
        : DEFAULT_SETTINGS.color;
      this.plugin.settings.color = color;
      await this.plugin.saveSettings();
      this.plugin.applyStyle();
      return;
    }

    if (key === "opacity") {
      if (typeof value !== "number" || !Number.isFinite(value)) return;
      this.plugin.settings.opacity = Math.min(0.8, Math.max(0.1, Math.round(value * 100) / 100));
      await this.plugin.saveSettings();
      this.plugin.applyStyle();
    }
  }

  private async restoreDefaults(): Promise<void> {
    this.plugin.settings = { ...DEFAULT_SETTINGS };
    await this.plugin.saveSettings();
    this.plugin.setMode(DEFAULT_SETTINGS.defaultMode);
    this.plugin.applyStyle();
    this.update();
  }
}
