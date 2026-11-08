/**
 * 冒烟测试：用极简的 obsidian 模块打桩，确认 main.js 能在 Node 里被加载。
 * 目的不是测功能，而是拦住「打包产物语法错误 / 顶层引用缺失 / manifest 不一致」这类低级问题。
 *
 * 运行：npm run smoke
 */
const assert = require("node:assert/strict");
const Module = require("node:module");
const fs = require("node:fs");
const path = require("node:path");

const stubPath = path.join(__dirname, "obsidian-stub.cjs");
const mainPath = path.join(__dirname, "..", "main.js");
const manifestPath = path.join(__dirname, "..", "manifest.json");

// 让 require("obsidian") 解析到本地打桩文件
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function resolveFilename(request, ...rest) {
  if (request === "obsidian") return stubPath;
  return originalResolve.call(this, request, ...rest);
};

assert.ok(fs.existsSync(mainPath), "缺少 main.js，请先运行 npm run build");
const bundleSize = fs.statSync(mainPath).size;
assert.ok(bundleSize > 10_000, `main.js 体积异常：${bundleSize} 字节（可能打包失败）`);

const bundleSource = fs.readFileSync(mainPath, "utf8");
assert.ok(bundleSource.includes("pdfhl-layer"), "main.js 里没有渲染层类名，打包内容疑似不完整");
assert.ok(bundleSource.includes("pdfhl-embed-controls"), "main.js 里没有内嵌 PDF 控件，打包内容疑似不完整");
assert.ok(bundleSource.includes("embed-actions"), "main.js 里没有原生操作按钮定位逻辑，打包内容疑似不完整");
assert.ok(bundleSource.includes("pdf-toolbar-right"), "main.js 里没有原生 PDF 工具栏定位逻辑，打包内容疑似不完整");
assert.ok(bundleSource.includes("rects="), "main.js 里没有多区域高亮参数，打包内容疑似不完整");
assert.ok(bundleSource.includes("generateMarkdownLink"), "main.js 里没有链接生成调用，打包内容疑似不完整");

const exported = require(mainPath);
const PluginClass = exported.default;
assert.equal(typeof PluginClass, "function", "main.js 没有默认导出插件类");

const { Plugin } = require(stubPath);
assert.ok(PluginClass.prototype instanceof Plugin, "插件类没有继承 obsidian 的 Plugin");

const instance = new PluginClass();
assert.equal(instance.settings.defaultMode, "none", "默认模式应为无模式（不干预鼠标）");
assert.equal(instance.settings.color, "yellow", "默认颜色应为黄色");
assert.equal(instance.settings.opacity, 0.35, "默认透明度应为 0.35");

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
assert.equal(manifest.id, "pdf-highlight-link", "manifest.json 的 id 与部署目录名不一致");
assert.equal(manifest.name, "PDF Highlight Link", "manifest.json 的显示名应为英文");
assert.equal(manifest.isDesktopOnly, true, "插件应标记为仅桌面端");
assert.equal(typeof manifest.minAppVersion, "string", "manifest.json 缺少 minAppVersion");

console.log(`✓ 打包产物可加载（${(bundleSize / 1024).toFixed(1)} KB）`);
console.log("✓ 默认设置与 manifest 校验通过");

// 设置迁移：旧数据（没有 schemaVersion、默认文字模式）应回到无模式，且不丢颜色/透明度
(async () => {
  instance.loadData = async () => ({ defaultMode: "text", color: "blue", opacity: 0.3 });
  await instance.loadSettings();
  assert.equal(instance.settings.defaultMode, "none", "旧数据应迁移为无模式");
  assert.equal(instance.settings.color, "blue", "迁移不应丢掉颜色");
  assert.equal(instance.settings.opacity, 0.3, "迁移不应丢掉透明度");
  assert.ok(instance.settings.schemaVersion >= 2, "迁移后应写入 schemaVersion");

  // 新数据（schemaVersion=2）应保留用户选择的默认模式
  instance.loadData = async () => ({ schemaVersion: 2, defaultMode: "rect", color: "green", opacity: 0.4 });
  await instance.loadSettings();
  assert.equal(instance.settings.defaultMode, "rect", "新版数据应保留用户选择的默认模式");
  console.log("✓ 设置迁移与三态默认值校验通过");
  console.log("\n冒烟测试通过\n");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
