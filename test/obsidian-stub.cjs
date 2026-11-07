/**
 * 冒烟测试用的 obsidian 模块打桩。
 * 只实现 main.js 在「加载 + 实例化插件类」阶段真正用到的成员；
 * 任何插件运行时能力都不在这里模拟（那需要真实 Obsidian）。
 */
class Events {}

class Component {
  onload() {}
  onunload() {}
  registerEvent() {}
  registerDomEvent() {}
  registerInterval() {}
  addChild() {
    return this;
  }
  removeChild() {}
}

class Plugin extends Component {
  constructor(app, manifest) {
    super();
    this.app = app;
    this.manifest = manifest;
  }
  registerView() {}
  registerMarkdownPostProcessor() {}
  addRibbonIcon() {
    return { remove() {} };
  }
  addCommand() {
    return { id: "", name: "" };
  }
  addSettingTab() {}
  registerObsidianProtocolHandler() {}
  async loadData() {
    return null;
  }
  async saveData() {}
}

class ItemView extends Component {
  constructor(leaf) {
    super();
    this.leaf = leaf;
    this.app = leaf && leaf.app ? leaf.app : {};
    this.containerEl = { empty() {}, addClass() {}, createDiv() {}, createEl() {} };
    this.contentEl = this.containerEl;
  }
  getViewType() {
    return "";
  }
  getDisplayText() {
    return "";
  }
  getIcon() {
    return "";
  }
  async onOpen() {}
  async onClose() {}
}

class PluginSettingTab {
  constructor(app, plugin) {
    this.app = app;
    this.plugin = plugin;
    this.containerEl = { empty() {}, createDiv() {}, createEl() {} };
  }
  display() {}
}

class Setting {
  constructor() {}
  setName() {
    return this;
  }
  setDesc() {
    return this;
  }
  setHeading() {
    return this;
  }
  addDropdown() {
    return this;
  }
  addSlider() {
    return this;
  }
  addToggle() {
    return this;
  }
  addButton() {
    return this;
  }
}

class Notice {
  constructor(message) {
    this.message = message;
    this.noticeEl = null;
  }
  setMessage(message) {
    this.message = message;
  }
  hide() {}
}

class MarkdownView extends ItemView {}

class TFile {
  constructor(pathValue) {
    this.path = pathValue;
    this.extension = "pdf";
    this.basename = "test";
  }
}

function setIcon() {}
function parseLinktext(linktext) {
  const hashIndex = linktext.indexOf("#");
  if (hashIndex < 0) return { path: linktext, subpath: "" };
  return { path: linktext.slice(0, hashIndex), subpath: linktext.slice(hashIndex) };
}

module.exports = {
  Events,
  Component,
  Plugin,
  ItemView,
  MarkdownView,
  PluginSettingTab,
  Setting,
  Notice,
  TFile,
  setIcon,
  parseLinktext,
};
