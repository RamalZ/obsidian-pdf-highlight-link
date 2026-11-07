/**
 * 纯函数单元测试（不依赖 Obsidian 运行时）。
 * 运行：npm run test  →  node test/run.ts
 */
import assert from "node:assert/strict";
import {
  MIN_RECT_SIZE,
  buildLinkAlias,
  buildRectSubpath,
  buildReferenceBlock,
  buildSubpath,
  buildTextSubpath,
  entrySnippet,
  extractQuoteLine,
  formatCoord,
  makeRectFromSize,
  normalizeRect,
  parseHighlightSubpath,
  resolveAlias,
  roundCoord,
  sanitizeAlias,
} from "../src/core/link.ts";
import {
  clampRect,
  isUsableRect,
  normalizeClientRect,
  rectFromPoints,
  rectsIntersect,
  toPercentStyle,
  unionRects,
} from "../src/core/geometry.ts";
import { isViewerAlive, stripFloatSelectionParam } from "../src/viewer/pdf-viewer-api.ts";
import { getStrings, normalizeLocale, setLocale } from "../src/i18n/strings.ts";

let passed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    passed += 1;
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    throw error;
  }
}

/** 浮点比较（坐标是 4 位小数，容差 1e-9 足够） */
function close(actual: number, expected: number, label: string): void {
  assert.ok(
    Math.abs(actual - expected) < 1e-9,
    `${label}: 期望 ${expected}，实际 ${actual}`,
  );
}

// ---------------------------------------------------------------------------
// link.ts
// ---------------------------------------------------------------------------

test("normalizeRect 处理反向拖拽", () => {
  const rect = normalizeRect(0.6, 0.8, 0.2, 0.3);
  assert.ok(rect);
  close(rect.x, 0.2, "x");
  close(rect.y, 0.3, "y");
  close(rect.w, 0.4, "w");
  close(rect.h, 0.5, "h");
});

test("normalizeRect 越界坐标夹到页面内", () => {
  const rect = normalizeRect(-0.5, -0.2, 1.4, 3);
  assert.ok(rect);
  close(rect.x, 0, "x");
  close(rect.y, 0, "y");
  close(rect.w, 1, "w");
  close(rect.h, 1, "h");
});

test("normalizeRect 丢弃过小的矩形", () => {
  assert.equal(normalizeRect(0.1, 0.1, 0.1 + MIN_RECT_SIZE / 2, 0.5), null);
  assert.equal(normalizeRect(0.1, 0.1, 0.5, 0.1 + MIN_RECT_SIZE / 2), null);
});

test("normalizeRect 拒绝非数字", () => {
  assert.equal(normalizeRect(Number.NaN, 0, 1, 1), null);
  assert.equal(normalizeRect(0, 0, Number.POSITIVE_INFINITY, 1), null);
});

test("makeRectFromSize 处理负宽高", () => {
  const rect = makeRectFromSize(0.6, 0.7, -0.2, -0.3);
  assert.ok(rect);
  close(rect.x, 0.4, "x");
  close(rect.y, 0.4, "y");
  close(rect.w, 0.2, "w");
  close(rect.h, 0.3, "h");
});

test("parseHighlightSubpath 解析文字型链接", () => {
  const parsed = parseHighlightSubpath("#page=3&selection=0.1,0.2,0.3,0.4");
  assert.ok(parsed);
  assert.equal(parsed.page, 3);
  assert.equal(parsed.kind, "text");
  close(parsed.rect.x, 0.1, "x");
  close(parsed.rect.y, 0.2, "y");
  close(parsed.rect.w, 0.2, "w");
  close(parsed.rect.h, 0.2, "h");
});

test("parseHighlightSubpath 解析区域型链接", () => {
  const parsed = parseHighlightSubpath("#page=5&rect=0.1,0.2,0.3,0.4");
  assert.ok(parsed);
  assert.equal(parsed.page, 5);
  assert.equal(parsed.kind, "rect");
  close(parsed.rect.w, 0.3, "w");
  close(parsed.rect.h, 0.4, "h");
});

test("parseHighlightSubpath 同时存在 rect 与 selection 时以 rect 为准", () => {
  const parsed = parseHighlightSubpath("#page=2&selection=0,0,0.5,0.5&rect=0.2,0.2,0.1,0.1");
  assert.ok(parsed);
  assert.equal(parsed.kind, "rect");
  close(parsed.rect.x, 0.2, "x");
});

test("parseHighlightSubpath 容忍没有 # 的 subpath", () => {
  const parsed = parseHighlightSubpath("page=1&selection=0.1,0.1,0.2,0.2");
  assert.ok(parsed);
  assert.equal(parsed.page, 1);
});

test("parseHighlightSubpath 非法输入返回 null", () => {
  assert.equal(parseHighlightSubpath(null), null);
  assert.equal(parseHighlightSubpath(""), null);
  assert.equal(parseHighlightSubpath("#page=0&rect=0.1,0.1,0.2,0.2"), null);
  assert.equal(parseHighlightSubpath("#page=abc&rect=0.1,0.1,0.2,0.2"), null);
  assert.equal(parseHighlightSubpath("#page=3"), null);
  assert.equal(parseHighlightSubpath("#page=3&rect=0.1,0.1,0.2"), null);
  assert.equal(parseHighlightSubpath("#page=3&rect=a,b,c,d"), null);
});

test("buildTextSubpath → parseHighlightSubpath 往返一致", () => {
  const rect = { x: 0.1234, y: 0.2345, w: 0.3456, h: 0.4567 };
  const subpath = buildTextSubpath(7, rect);
  assert.ok(subpath.startsWith("#page=7&selection="));
  const parsed = parseHighlightSubpath(subpath);
  assert.ok(parsed);
  assert.equal(parsed.kind, "text");
  assert.equal(parsed.page, 7);
  close(parsed.rect.x, 0.1234, "x");
  close(parsed.rect.y, 0.2345, "y");
  close(parsed.rect.w, 0.3456, "w");
  close(parsed.rect.h, 0.4567, "h");
});

test("buildRectSubpath → parseHighlightSubpath 往返一致", () => {
  const rect = { x: 0.05, y: 0.06, w: 0.2, h: 0.3 };
  const subpath = buildRectSubpath(2, rect);
  assert.equal(subpath, "#page=2&rect=0.05,0.06,0.2,0.3");
  const parsed = parseHighlightSubpath(subpath);
  assert.ok(parsed);
  assert.equal(parsed.kind, "rect");
  close(parsed.rect.x, 0.05, "x");
  close(parsed.rect.w, 0.2, "w");
});

test("buildSubpath 按类型选择参数", () => {
  assert.ok(buildSubpath(1, "text", { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }).includes("selection="));
  assert.ok(buildSubpath(1, "rect", { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }).includes("rect="));
});

test("buildSubpath 生成的坐标永远在 0–1 之间", () => {
  const subpath = buildRectSubpath(1, { x: 0.98, y: 0.98, w: 0.5, h: 0.5 });
  const parsed = parseHighlightSubpath(subpath);
  assert.ok(parsed);
  assert.ok(parsed.rect.x + parsed.rect.w <= 1.0001);
  assert.ok(parsed.rect.y + parsed.rect.h <= 1.0001);
});

test("formatCoord / roundCoord 固定精度", () => {
  assert.equal(roundCoord(0.123456), 0.1235);
  assert.equal(formatCoord(0.5), "0.5");
  assert.equal(formatCoord(1), "1");
  assert.equal(formatCoord(0.00004), "0");
});

test("sanitizeAlias 清洗会破坏链接的字符", () => {
  assert.equal(sanitizeAlias("a|b"), "a｜b");
  assert.equal(sanitizeAlias("[[x]]"), "［［x］］");
  assert.equal(sanitizeAlias("第一行\r\n第二行"), "第一行 第二行");
  assert.equal(sanitizeAlias("  多余   空白  "), "多余 空白");
  assert.equal(sanitizeAlias(null), "");
});

test("resolveAlias 空别名兜底", () => {
  assert.equal(resolveAlias("", "text"), "文字高亮");
  assert.equal(resolveAlias("   ", "rect"), "区域批注");
  assert.equal(resolveAlias("某段文字", "text"), "某段文字");
});

test("entrySnippet 截断与区域文案", () => {
  assert.equal(entrySnippet("", "rect"), "区域批注");
  assert.equal(entrySnippet("", "text"), "文字高亮");
  const long = "一".repeat(31);
  assert.equal(entrySnippet(long, "text"), `${"一".repeat(30)}…`);
  assert.equal(entrySnippet("短文本", "text"), "短文本");
});

test("buildReferenceBlock 生成「引用行 + 空行 + 链接」块", () => {
  const link = "[[a.pdf#page=3&selection=0.1,0.2,0.3,0.4|a.pdf, 第 3 页]]";
  assert.equal(
    buildReferenceBlock(link, "text", "第一行\n第二行"),
    `> 第一行\n> 第二行\n\n${link}`,
  );
  // 文字选区没有文本时只留一个空引用行
  assert.equal(buildReferenceBlock(link, "text", ""), `>\n\n${link}`);
});

test("buildReferenceBlock 区域型用占位文案", () => {
  const link = "[[a.pdf#page=5&rect=0.1,0.2,0.3,0.4|a.pdf, 第 5 页]]";
  assert.equal(
    buildReferenceBlock(link, "rect", null),
    `> （此处由使用者根据区域内容自行填写）\n\n${link}`,
  );
});

test("buildLinkAlias 与原生 PDF 引用别名一致", () => {
  assert.equal(buildLinkAlias("论文.pdf", 3), "论文.pdf, 第 3 页");
  assert.equal(buildLinkAlias("a.pdf", 12), "a.pdf, 第 12 页");
});

test("normalizeLocale 归一化语言代码", () => {
  assert.equal(normalizeLocale("zh"), "zh");
  assert.equal(normalizeLocale("zh-CN"), "zh");
  assert.equal(normalizeLocale("zh-Hant"), "zh-TW");
  assert.equal(normalizeLocale("zh-Hant-TW"), "zh-TW");
  assert.equal(normalizeLocale("zh-TW"), "zh-TW");
  assert.equal(normalizeLocale("zh-Hans-CN"), "zh");
  assert.equal(normalizeLocale("en-US"), "en");
  assert.equal(normalizeLocale(""), "en");
});

test("i18n：英文别名、兜底文案与区域占位", () => {
  try {
    setLocale("en");
    assert.equal(buildLinkAlias("a.pdf", 3), "a.pdf, page 3");
    assert.equal(resolveAlias("", "text"), "Text highlight");
    assert.equal(resolveAlias("", "rect"), "Region note");
    assert.equal(entrySnippet("", "rect"), "Region note");
    assert.equal(
      buildReferenceBlock("[[a.pdf#page=2&rect=0.1,0.1,0.2,0.2]]", "rect", null),
      "> (Describe the region content here)\n\n[[a.pdf#page=2&rect=0.1,0.1,0.2,0.2]]",
    );
  } finally {
    setLocale("zh");
  }
});

test("i18n：繁体别名与兜底文案", () => {
  try {
    setLocale("zh-TW");
    assert.equal(buildLinkAlias("a.pdf", 3), "a.pdf, 第 3 頁");
    assert.equal(resolveAlias("", "text"), "文字醒目提示");
    assert.equal(resolveAlias("", "rect"), "區域註記");
  } finally {
    setLocale("zh");
  }
});

test("i18n：原生别名模式同时识别简繁英", () => {
  const patterns = getStrings().nativeAliasPatterns;
  const matches = (alias: string) => patterns.some((pattern) => pattern.test(alias));
  assert.equal(matches("a.pdf, 第 3 页"), true);
  assert.equal(matches("a.pdf, 第 3 頁"), true);
  assert.equal(matches("a.pdf, page 3"), true);
  assert.equal(matches("a.pdf, Page 12"), true);
  assert.equal(matches("a.pdf, 3 页"), false);
});

test("extractQuoteLine 从链接上方取引用行", () => {
  const lines = [
    "# 标题",
    "",
    "> 被选中的原文",
    "",
    "[[a.pdf#page=3&selection=0.1,0.2,0.3,0.4|a.pdf, 3 页]]",
  ];
  assert.equal(extractQuoteLine(lines, 4), "被选中的原文");
  // 中间先遇到普通段落就放弃，避免误取别的段落
  assert.equal(extractQuoteLine(["普通段落", "[[a.pdf#page=1&selection=0,0,0.1,0.1|x]]"], 1), "");
  // 越界行号返回空字符串
  assert.equal(extractQuoteLine(["[]"], 99), "");
});

// ---------------------------------------------------------------------------
// geometry.ts
// ---------------------------------------------------------------------------

test("clampRect 夹取到页面内", () => {
  const rect = clampRect({ x: -0.2, y: 0.9, w: 0.5, h: 0.5 });
  close(rect.x, 0, "x");
  close(rect.y, 0.9, "y");
  close(rect.w, 0.5, "w");
  close(rect.h, 0.1, "h");
});

test("rectFromPoints 与 unionRects", () => {
  const a = rectFromPoints(0.5, 0.5, 0.2, 0.1);
  close(a.x, 0.2, "a.x");
  const union = unionRects([
    { x: 0.1, y: 0.1, w: 0.1, h: 0.1 },
    { x: 0.5, y: 0.2, w: 0.2, h: 0.3 },
  ]);
  assert.ok(union);
  close(union.x, 0.1, "u.x");
  close(union.y, 0.1, "u.y");
  close(union.w, 0.6, "u.w");
  close(union.h, 0.4, "u.h");
  assert.equal(unionRects([]), null);
});

test("isUsableRect 过滤误触", () => {
  assert.equal(isUsableRect({ x: 0, y: 0, w: 0.001, h: 0.5 }), false);
  assert.equal(isUsableRect({ x: 0, y: 0, w: 0.5, h: 0.5 }), true);
});

test("toPercentStyle 输出百分比", () => {
  const style = toPercentStyle({ x: 0.25, y: 0.5, w: 0.25, h: 0.125 });
  assert.equal(style.left, "25.000%");
  assert.equal(style.top, "50.000%");
  assert.equal(style.width, "25.000%");
  assert.equal(style.height, "12.500%");
});

test("normalizeClientRect 扣除页面边框", () => {
  const box = { left: 100, top: 200, width: 400, height: 800 };
  const rect = normalizeClientRect(box, { left: 200, top: 400, right: 300, bottom: 600 });
  close(rect.x, 0.25, "x");
  close(rect.y, 0.25, "y");
  close(rect.w, 0.25, "w");
  close(rect.h, 0.25, "h");
});

test("normalizeClientRect 处理零尺寸容器", () => {
  const rect = normalizeClientRect({ left: 0, top: 0, width: 0, height: 0 }, {
    left: 0,
    top: 0,
    right: 10,
    bottom: 10,
  });
  assert.deepEqual(rect, { x: 0, y: 0, w: 0, h: 0 });
});

test("rectsIntersect 判断相交", () => {
  const a = { x: 0.1, y: 0.1, w: 0.2, h: 0.2 };
  assert.equal(rectsIntersect(a, { x: 0.2, y: 0.2, w: 0.2, h: 0.2 }), true);
  assert.equal(rectsIntersect(a, { x: 0.5, y: 0.5, w: 0.1, h: 0.1 }), false);
});

test("parseHighlightSubpath 支持 URL 编码的 subpath", () => {
  // useMarkdownLinks 开启时 Obsidian 生成的链接会把 = , & 编码
  const parsed = parseHighlightSubpath("#page%3D3%26selection%3D0.1%2C0.2%2C0.3%2C0.4");
  assert.ok(parsed);
  assert.equal(parsed.page, 3);
  assert.equal(parsed.kind, "text");
  close(parsed.rect.x, 0.1, "x");
  close(parsed.rect.y, 0.2, "y");
  close(parsed.rect.w, 0.2, "w");
  close(parsed.rect.h, 0.2, "h");
});

test("isViewerAlive 把 pdfViewer 为空视为已卸载", () => {
  const unloaded = { containerEl: {}, pdfViewer: null };
  assert.equal(isViewerAlive(unloaded as never), false);
  const ready = { containerEl: {}, pdfViewer: { pdfViewer: { getPageView: () => undefined } } };
  assert.equal(isViewerAlive(ready as never), true);
});

test("stripFloatSelectionParam 只摘浮点 selection，保留 page 与 rect", () => {
  assert.equal(
    stripFloatSelectionParam("#page=3&selection=0.1,0.2,0.3,0.4"),
    "#page=3",
  );
  // 整数 selection（PDF++ 的字符下标语义）与 rect 参数不能动
  assert.equal(stripFloatSelectionParam("#page=3&selection=4,0,5,20"), "#page=3&selection=4,0,5,20");
  assert.equal(stripFloatSelectionParam("#page=5&rect=0.1,0.2,0.3,0.4"), "#page=5&rect=0.1,0.2,0.3,0.4");
});

console.log(`\n全部通过：${passed} 项测试\n`);
