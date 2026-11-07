#!/usr/bin/env node
/**
 * 部署脚本：把 main.js / manifest.json / styles.css 复制到 Obsidian vault 的插件目录。
 *
 * 用法：
 *   npm run deploy                         从 %APPDATA%\obsidian\obsidian.json 读取 vault 列表并选择
 *   npm run deploy -- --vault "F:\Vault"   跳过选择，直接部署到指定 vault
 *   node scripts/deploy.mjs --config <file> 指定 obsidian.json 路径（测试用）
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import process from "node:process";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

/** 插件目录名（必须与 manifest.json 的 id 一致） */
const PLUGIN_ID = "pdf-highlight-link";
/** 需要复制的产物 */
const FILES = ["main.js", "manifest.json", "styles.css"];
/** 交互选择的最大重试次数 */
const MAX_SELECT_ATTEMPTS = 3;

const projectRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

function fail(message) {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

/** 让输出在当前终端里更整齐的文件大小 */
function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Windows 路径大小写不敏感，去重时统一小写 */
function pathKey(value) {
  return process.platform === "win32" ? value.toLowerCase() : value;
}

function printHelp() {
  console.log(`PDF 高亮链接 · 部署脚本

用法：
  node scripts/deploy.mjs [--vault <路径>] [--config <obsidian.json>]

参数：
  --vault <路径>     直接部署到指定 vault（跳过交互选择）
  --config <文件>    指定 Obsidian 配置文件路径（默认 %APPDATA%\\obsidian\\obsidian.json）
  -h, --help         显示本帮助
`);
}

function parseArgs(argv) {
  const options = { vault: null, config: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "-h" || arg === "--help") {
      printHelp();
      process.exit(0);
    }
    if (arg === "--vault" || arg === "--config") {
      const value = argv[index + 1];
      index += 1;
      if (!value || value.startsWith("--")) fail(`参数 ${arg} 缺少路径值`);
      if (arg === "--vault") options.vault = value;
      else options.config = value;
      continue;
    }
    if (arg.startsWith("--vault=")) {
      options.vault = arg.slice("--vault=".length);
      continue;
    }
    if (arg.startsWith("--config=")) {
      options.config = arg.slice("--config=".length);
      continue;
    }
    fail(`未知参数：${arg}（用 --help 查看用法）`);
  }
  return options;
}

// ---------------------------------------------------------------------------
// vault 解析
// ---------------------------------------------------------------------------

function defaultConfigPath() {
  if (process.env.APPDATA) return path.join(process.env.APPDATA, "obsidian", "obsidian.json");
  return path.join(homedir(), "AppData", "Roaming", "obsidian", "obsidian.json");
}

/** 校验路径是否是一个可部署的 vault（目录存在且带 .obsidian） */
function isValidVault(vaultPath) {
  try {
    return existsSync(vaultPath) && statSync(vaultPath).isDirectory() && existsSync(path.join(vaultPath, ".obsidian"));
  } catch {
    return false;
  }
}

/** 读取 obsidian.json，返回去重后的 vault 列表（保留 isOpen 标记，便于提示） */
function readVaultList(configPath) {
  if (!existsSync(configPath)) {
    fail(`找不到 Obsidian 配置文件：${configPath}\n  请先运行一次 Obsidian，或用 --vault <路径> 手动指定 vault。`);
  }

  let data;
  try {
    // 去掉可能存在的 UTF-8 BOM（Windows 下手改过的配置文件常见）
    const text = readFileSync(configPath, "utf8").replace(/^\uFEFF/, "");
    data = JSON.parse(text);
  } catch (error) {
    fail(`解析 ${configPath} 失败：${error instanceof Error ? error.message : String(error)}`);
  }

  const vaults = data && typeof data === "object" ? data.vaults : null;
  if (!vaults || typeof vaults !== "object") {
    fail(`${configPath} 里没有 vault 列表，请用 --vault <路径> 手动指定。`);
  }

  const seen = new Set();
  const result = [];
  for (const entry of Object.values(vaults)) {
    if (!entry || typeof entry !== "object" || typeof entry.path !== "string" || !entry.path) continue;
    const resolved = path.resolve(entry.path);
    const key = pathKey(resolved);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ path: resolved, isOpen: entry.open === true, valid: isValidVault(resolved) });
  }
  return result;
}

/** 多 vault 时让用户输入编号 */
async function promptVault(vaults) {
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  try {
    for (let attempt = 1; attempt <= MAX_SELECT_ATTEMPTS; attempt += 1) {
      const answer = (await readline.question(`请输入编号 (1-${vaults.length})：`)).trim();
      if (/^\d+$/.test(answer)) {
        const index = Number.parseInt(answer, 10) - 1;
        if (index >= 0 && index < vaults.length) return vaults[index].path;
      }
      if (attempt < MAX_SELECT_ATTEMPTS) console.warn(`  无效编号「${answer}」，请重新输入。`);
    }
    fail("连续 3 次输入无效编号，已退出。");
  } finally {
    readline.close();
  }
}

async function resolveVault(options) {
  if (options.vault) {
    const vaultPath = path.resolve(options.vault.replace(/^"(.*)"$/, "$1"));
    if (!isValidVault(vaultPath)) {
      fail(`无效的 vault：${vaultPath}\n  该目录不存在、不是目录，或缺少 .obsidian 文件夹。`);
    }
    return { path: vaultPath, source: "--vault" };
  }

  const configPath = options.config ? path.resolve(options.config) : defaultConfigPath();
  console.log(`读取 Obsidian 配置：${configPath}`);
  const all = readVaultList(configPath);
  const valid = all.filter((item) => item.valid);
  for (const item of all) {
    if (!item.valid) console.warn(`  跳过无效 vault：${item.path}`);
  }
  if (valid.length === 0) {
    fail(`配置里没有可用的 vault。\n  默认配置：${configPath}`);
  }

  if (valid.length === 1) {
    console.log(`检测到 1 个 vault：${valid[0].path}`);
    return { path: valid[0].path, source: "自动" };
  }

  console.log("\n检测到多个 vault：");
  valid.forEach((item, index) => {
    const tags = [];
    if (item.isOpen) tags.push("当前打开");
    console.log(`  [${index + 1}] ${item.path}${tags.length ? `  （${tags.join("，")}）` : ""}`);
  });

  if (!process.stdin.isTTY) {
    fail("检测到多个 vault，但当前终端不支持交互选择。\n  请改用：npm run deploy -- --vault <路径>");
  }

  const chosen = await promptVault(valid);
  return { path: chosen, source: "手动选择" };
}

// ---------------------------------------------------------------------------
// 部署
// ---------------------------------------------------------------------------

function copyArtifacts(targetDir) {
  console.log(`\n部署到：${targetDir}`);
  try {
    mkdirSync(targetDir, { recursive: true });
  } catch (error) {
    fail(`创建目录失败：${targetDir}\n  ${error instanceof Error ? error.message : String(error)}`);
  }

  for (const file of FILES) {
    const source = path.join(projectRoot, file);
    if (!existsSync(source)) {
      if (file === "main.js") fail("缺少 main.js，请先运行 npm run build 再部署。");
      fail(`缺少源文件：${source}`);
    }
    const target = path.join(targetDir, file);
    try {
      copyFileSync(source, target);
      console.log(`  ✓ ${file} (${formatSize(statSync(target).size)})`);
    } catch (error) {
      fail(`复制 ${file} 失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

async function main() {
  process.on("SIGINT", () => {
    console.log("\n已取消部署。");
    process.exit(130);
  });

  const options = parseArgs(process.argv.slice(2));
  const vault = await resolveVault(options);
  const targetDir = path.join(vault.path, ".obsidian", "plugins", PLUGIN_ID);
  copyArtifacts(targetDir);

  console.log(`\n✓ 部署完成（vault 来源：${vault.source}）`);
  console.log("下一步：Obsidian → 设置 → 第三方插件 → 重新载入（或重启 Obsidian）→ 启用「PDF 高亮链接」\n");
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
