import { PluginSettingTab, Setting } from "obsidian";
import type { App } from "obsidian";
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

export class PdfHighlightSettingTab extends PluginSettingTab {
  private plugin: PdfHighlightLinkPlugin;

  constructor(app: App, plugin: PdfHighlightLinkPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    const strings = getStrings();
    containerEl.empty();

    new Setting(containerEl)
      .setName(strings.settingDefaultModeName)
      .setDesc(strings.settingDefaultModeDesc)
      .addDropdown((dropdown) => {
        for (const option of getModeOptions()) dropdown.addOption(option.value, option.label);
        dropdown
          .setValue(this.plugin.settings.defaultMode)
          .onChange(async (value) => {
            const mode: ActiveMode = VALID_MODES.includes(value as ActiveMode)
              ? (value as ActiveMode)
              : DEFAULT_SETTINGS.defaultMode;
            this.plugin.settings.defaultMode = mode;
            await this.plugin.saveSettings();
            this.plugin.setMode(mode);
          });
      });

    new Setting(containerEl)
      .setName(strings.settingColorName)
      .setDesc(strings.settingColorDesc)
      .addDropdown((dropdown) => {
        for (const option of getColorOptions()) dropdown.addOption(option.value, option.label);
        dropdown.setValue(this.plugin.settings.color).onChange(async (value) => {
          const color = VALID_COLORS.includes(value as HighlightColor)
            ? (value as HighlightColor)
            : DEFAULT_SETTINGS.color;
          this.plugin.settings.color = color;
          await this.plugin.saveSettings();
          this.plugin.applyStyle();
        });
      });

    new Setting(containerEl)
      .setName(strings.settingOpacityName)
      .setDesc(strings.settingOpacityDesc)
      .addSlider((slider) => {
        slider
          .setLimits(0.1, 0.8, 0.05)
          .setValue(this.plugin.settings.opacity)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.opacity = Math.round(value * 100) / 100;
            await this.plugin.saveSettings();
            this.plugin.applyStyle();
          });
      });

    new Setting(containerEl)
      .setName(strings.settingRestoreName)
      .setDesc(strings.settingRestoreDesc)
      .addButton((button) => {
        button.setButtonText(strings.settingRestoreButton).onClick(async () => {
          this.plugin.settings = { ...DEFAULT_SETTINGS };
          await this.plugin.saveSettings();
          this.plugin.setMode(DEFAULT_SETTINGS.defaultMode);
          this.plugin.applyStyle();
          this.display();
        });
      });
  }
}
