#!/usr/bin/env node
/**
 * 打包脚本：把构建产物整理成可以直接拷给别人使用的插件文件夹，并生成 zip。
 *
 * 用法：
 *   npm run package
 *
 * 产物：
 *   dist/pdf-highlight-link/
 *     main.js
 *     manifest.json
 *     styles.css
 *     INSTALL.txt
 *   dist/pdf-highlight-link-<版本>.zip
 *
 * 收件人（Windows / macOS）不需要 Node，按 INSTALL.txt 把文件夹放进 vault 的插件目录即可。
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

/** 插件目录名（必须与 manifest.json 的 id 一致，否则 Obsidian 不认） */
const EXPECTED_ID = "pdf-highlight-link";
/** 需要打包的产物（data.json 不打包，让对方使用默认设置） */
const FILES = ["main.js", "manifest.json", "styles.css"];
/** 安装说明文件名：保持 ASCII，避免 zip 中文名在不同解压工具里乱码 */
const GUIDE_NAME = "INSTALL.txt";

const projectRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

function fail(message) {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

/** 让输出在终端里更整齐的文件大小 */
function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function readManifest() {
  const file = path.join(projectRoot, "manifest.json");
  if (!existsSync(file)) fail("缺少 manifest.json，无法打包。");
  try {
    // 去掉可能存在的 UTF-8 BOM
    return JSON.parse(readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
  } catch (error) {
    fail(`解析 manifest.json 失败：${error instanceof Error ? error.message : String(error)}`);
  }
}

/** 生成随包分发的安装说明（Windows + macOS 通用，不需要任何命令行操作） */
function buildInstallGuide(manifest) {
  return `PDF Highlight Link ${manifest.version} · 安装说明（Windows / macOS）
====================================================

这是一个 Obsidian 桌面端插件：在 PDF 标签页或笔记内嵌 PDF 里选中文字或拖框选区，复制成带页码/坐标的链接；
把链接贴进笔记后，重新打开这个 PDF 就会在对应位置显示半透明高亮。

· 支持 Obsidian 桌面版（Windows / macOS / Linux），不支持 iPhone / iPad。
· 要求 Obsidian 1.13.0 或更高版本。
· 不需要安装 Node，也不需要运行任何命令；插件只是普通 JS 文件。


一、安装（Windows 和 macOS 都适用）
-----------------------------------
1. 打开 Obsidian，进入 设置（Settings）→ 第三方插件（Community plugins）。
2. 点页面里的「打开插件文件夹 / Open plugins folder」按钮。
   Obsidian 会直接打开当前 vault 的 .obsidian/plugins 目录。
3. 把压缩包里解压出来的 pdf-highlight-link 整个文件夹复制进去。
   如果之前装过旧版本，覆盖原来的同名文件夹即可。
4. 完全退出 Obsidian，再重新打开。
5. 回到 设置 → 第三方插件：如果「限制模式 / Restricted mode」开着，先关掉；
   然后在「已安装插件」里找到「PDF Highlight Link」，打开开关。
6. 想保留旧的「颜色 / 透明度」设置：把旧插件目录里的 data.json 一起复制过来。
   （压缩包默认不含 data.json，对方会使用默认设置。）


二、检查文件夹层级（最容易出错的一步）
--------------------------------------
正确的层级（以 Windows 路径为例）：
  <你的 vault>\\.obsidian\\plugins\\pdf-highlight-link\\manifest.json
  <你的 vault>\\.obsidian\\plugins\\pdf-highlight-link\\main.js
  <你的 vault>\\.obsidian\\plugins\\pdf-highlight-link\\styles.css

常见错误：
  × 多套了一层：plugins\\pdf-highlight-link\\pdf-highlight-link\\manifest.json
  × 把 dist 文件夹整个放进去：plugins\\dist\\pdf-highlight-link\\...
  × 只放了压缩包，没有解压

Windows：资源管理器默认不显示以点开头的文件夹。若手动找路径，
先在「查看」里勾选「显示 → 隐藏的项目」，才能看到 .obsidian。

macOS：Finder 里按 Cmd + Shift + . 显示隐藏文件。

如果不知道 vault 在哪里：
  Windows：常见于 C:\\Users\\<你>\\Documents\\... 或 OneDrive 文档目录；
           也可以查看 %APPDATA%\\obsidian\\obsidian.json 里记录的 vault 列表。
  macOS：常见于 ~/Documents/... 或
           ~/Library/Mobile Documents/iCloud~md~obsidian/Documents/...（iCloud）。


三、解压注意事项
----------------
· Windows：右键压缩包 →「全部解压缩」，解压后应得到 pdf-highlight-link 文件夹；
  不要用「拖拽到 plugins 里」的方式制造嵌套目录。
· macOS：双击 zip，系统会自动解压出 pdf-highlight-link 文件夹。
· 压缩包内已经带顶层文件夹，解压后直接整个复制即可。


四、使用方法
------------
1. 打开任意 PDF。默认是「无模式」，可以正常浏览、滚动、选字。
2. 点 PDF 工具栏右侧的「文字模式」(T) 或「框选模式」(⬚)：
   （笔记内嵌的普通 PDF 没有原生工具栏，按钮显示在 PDF 右上角，鼠标悬停或聚焦时出现；画布内嵌仍用原生工具栏）
   - 文字模式：选中文字 → 弹出浮动工具栏；
   - 框选模式：按住鼠标拖出矩形 → 松开 → 同样的浮动工具栏。
3. 点「复制引用」：粘贴进笔记是「引用行 + 空行 + 链接」；
   点「复制链接」：只复制 [[文件.pdf#page=X&...|文件.pdf, 第 X 页]]。
   别名会跟随 Obsidian 界面语言：简体「第 X 页」、繁体「第 X 頁」、英文「page X」。
4. 重新打开这个 PDF，对应位置会出现高亮；
   右侧面板（命令面板搜「高亮面板」）会按页列出全部条目。


五、常见问题
------------
· 插件列表里看不到：99% 是文件夹多套了一层，按第二节检查层级。
· 启用了但没反应：重启 Obsidian；确认版本 ≥ 1.13.0；确认是桌面版。
· PDF 里没有高亮：确认链接写在笔记正文里（不是只看悬浮预览），
  并且链接中的文件名与 PDF 实际文件名一致。
· 命令面板 / 开发者工具：Windows 用 Ctrl+P / Ctrl+Shift+I，macOS 用 Cmd+P / Cmd+Option+I。
· 安全提示：插件是普通 JS 文件，Windows 的 SmartScreen、macOS 的 Gatekeeper
  都不会拦截它，不需要签名或额外授权。

版本：${manifest.version}    作者：${manifest.author}
`;
}

// ---------------------------------------------------------------- zip 写入
// 只做「存储」压缩（method 0）：不引入任何依赖，macOS / Windows 自带解压都能打开。
// 文件名使用 UTF-8 并设置 general purpose flag 0x800，避免中文/特殊字符乱码。

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[i] = value >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** 固定成 1980-01-01 00:00，保证每次打包出的 zip 完全一致 */
const DOS_TIME = 0;
const DOS_DATE = ((2024 - 1980) << 9) | (1 << 5) | 1;

/**
 * 写入一个 zip 文件。
 * @param {string} zipPath 目标路径
 * @param {{ name: string; data: Buffer }[]} entries 条目（name 用正斜杠）
 */
function writeZip(zipPath, entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const data = entry.data;
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // 本地文件头签名
    local.writeUInt16LE(20, 4); // 解压所需版本
    local.writeUInt16LE(0x0800, 6); // 文件名 UTF-8
    local.writeUInt16LE(0, 8); // 压缩方法：存储
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18); // 压缩后大小
    local.writeUInt32LE(data.length, 22); // 原始大小
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28); // 扩展字段长度

    localParts.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); // 中央目录签名
    central.writeUInt16LE(20, 4); // 创建者版本
    central.writeUInt16LE(20, 6); // 解压所需版本
    central.writeUInt16LE(0x0800, 8); // 文件名 UTF-8
    central.writeUInt16LE(0, 10); // 压缩方法
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30); // 扩展字段
    central.writeUInt16LE(0, 32); // 注释
    central.writeUInt16LE(0, 34); // 起始磁盘
    central.writeUInt16LE(0, 36); // 内部属性
    central.writeUInt32LE(0, 38); // 外部属性
    central.writeUInt32LE(offset, 42); // 本地头偏移
    centralParts.push(central, name);

    offset += local.length + name.length + data.length;
  }

  const centralBuffer = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); // 中央目录结束标记
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  writeFileSync(zipPath, Buffer.concat([...localParts, centralBuffer, end]));
}

function main() {
  const manifest = readManifest();
  if (manifest.id !== EXPECTED_ID) {
    fail(`manifest.json 的 id 必须是 "${EXPECTED_ID}"，当前是 "${manifest.id}"，否则 Obsidian 不认。`);
  }

  const mainJs = path.join(projectRoot, "main.js");
  if (!existsSync(mainJs)) fail("缺少 main.js，请先运行 npm run build 再打包。");

  const distDir = path.join(projectRoot, "dist");
  const outDir = path.join(distDir, EXPECTED_ID);
  try {
    rmSync(outDir, { recursive: true, force: true });
    mkdirSync(outDir, { recursive: true });
  } catch (error) {
    fail(`创建 dist 目录失败：${error instanceof Error ? error.message : String(error)}`);
  }

  console.log(`\n打包到：${outDir}`);
  const packaged = [];
  for (const file of FILES) {
    const source = path.join(projectRoot, file);
    if (!existsSync(source)) fail(`缺少源文件：${source}`);
    const target = path.join(outDir, file);
    try {
      copyFileSync(source, target);
      packaged.push(file);
      console.log(`  ✓ ${file} (${formatSize(statSync(target).size)})`);
    } catch (error) {
      fail(`复制 ${file} 失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  try {
    writeFileSync(path.join(outDir, GUIDE_NAME), buildInstallGuide(manifest), "utf8");
    packaged.push(GUIDE_NAME);
    console.log(`  ✓ ${GUIDE_NAME} (${formatSize(statSync(path.join(outDir, GUIDE_NAME)).size)})`);
  } catch (error) {
    fail(`生成安装说明失败：${error instanceof Error ? error.message : String(error)}`);
  }

  const zipPath = path.join(distDir, `${EXPECTED_ID}-${manifest.version}.zip`);
  try {
    rmSync(zipPath, { force: true });
    writeZip(
      zipPath,
      packaged.map((name) => ({
        name: `${EXPECTED_ID}/${name}`,
        data: readFileSync(path.join(outDir, name)),
      })),
    );
    console.log(`  ✓ ${path.basename(zipPath)} (${formatSize(statSync(zipPath).size)})`);
  } catch (error) {
    fail(`生成 zip 失败：${error instanceof Error ? error.message : String(error)}`);
  }

  console.log("\n✓ 打包完成");
  console.log("下一步：把 dist 里的 zip（或整个 pdf-highlight-link 文件夹）发给对方，");
  console.log(`        对方按 ${GUIDE_NAME} 操作即可，Windows / macOS 都适用，不需要 Node。\n`);
}

main();
