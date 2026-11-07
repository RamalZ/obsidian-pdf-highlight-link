# PDF 高亮链接（PDF Highlight Link）

[English](README.md) | **简体中文**

在 Obsidian 内置 PDF 阅读器（标签页或笔记内嵌）里选中文字或框选区域，一键复制指向该位置的 Markdown 链接；把链接粘贴进笔记后，再打开这个 PDF 就会在对应位置渲染半透明高亮。

- 不修改原 PDF 文件，高亮完全由反向链接（backlink）推导
- 复用 Obsidian 自带的 PDF.js 阅读器，不引入任何第三方运行库
- 仅桌面端（Obsidian 1.5+，已在 1.15.0 实测）

## 功能

- **三态模式**：默认「无模式」，PDF 完全按原生方式浏览；点工具栏右侧的「文字模式」或「框选模式」进入对应模式，再点一次同一个按钮就退出回无模式（文字模式下按 `T` 也是同样的开关）
- **笔记内嵌 PDF**：`![[文件.pdf]]` 直接显示在笔记里的 PDF 同样支持高亮、文字/框选、复制链接与右侧面板。普通内嵌的原生工具栏被 Obsidian 隐藏，插件会在 PDF 右上角显示模式按钮（悬停或聚焦时出现）；画布内嵌仍用原生工具栏。
- **文字模式**：选中文字 → 弹出浮动工具栏 → 「复制引用」或「复制链接」
- **框选模式**：拖出矩形 → 松开鼠标 → 弹出同一个浮动工具栏
- **复制引用**：跟 Obsidian 原生 PDF 引用一致——「引用行 + 空行 + 链接」，文字高亮把选中文字放进引用行，框选区域留一句占位文案由你自己补写：

  ```markdown
  > 选中的那段原文

  [[论文.pdf#page=3&selection=0.12,0.34,0.56,0.35|论文.pdf, 第 3 页]]
  ```

  ```markdown
  > （此处由使用者根据区域内容自行填写）

  [[论文.pdf#page=5&rect=0.1,0.2,0.3,0.4|论文.pdf, 第 5 页]]
  ```

- **复制链接**：只复制纯链接（`[[文件.pdf#page=...|文件.pdf, X 页]]`），怎么使用由你自己决定
- **高亮渲染**：打开 PDF 时读取 `metadataCache` 的反向链接，解析 `page` / `selection` / `rect`，在页面相应位置画高亮
- **右侧面板**：按页分组列出当前 PDF 的全部高亮（色点 + 内容片段 + 来源笔记），支持搜索过滤；点条目跳转到对应页并闪烁，点条目下方的小链接直接打开来源笔记并定位到那一行
- **设置**：默认模式（无模式/文字/框选）、高亮颜色（黄/绿/蓝/粉）、透明度
- **多语言界面**：命令、ribbon、工具栏按钮、浮动工具栏、右侧面板、设置页与提示文案跟随 Obsidian 界面语言（简体中文 / 繁体中文 / 英文）；未支持的语言回退英文

## 链接格式

文字选区（坐标是**对角两点**）：

```
[[文件.pdf#page=3&selection=0.12,0.34,0.56,0.35|文件.pdf, 第 3 页]]
```

区域框选（坐标是**左上角 + 宽高**）：

```
[[文件.pdf#page=5&rect=0.12,0.34,0.21,0.08|文件.pdf, 第 5 页]]
```

坐标一律是**相对页面内容盒的比例坐标（0–1，保留 4 位小数）**，不是像素值，所以缩放、平移、不同屏幕都不会漂移。多行选区取所有行的外接矩形；跨页选区归到起始页。

「复制引用」和「复制链接」的别名按当前界面语言生成：简体 **`文件.pdf, 第 X 页`**、繁体 **`檔案.pdf, 第 X 頁`**、英文 **`file.pdf, page X`**（与 Obsidian 原生 PDF 引用一致），所以选中文字本身不会占用别名；面板里的文字片段是从链接上方的引用行读回来的。三种格式的旧链接都能识别。

> **与 Obsidian 原生 PDF 链接的关系**：原生解析器把 `selection=` 当字符下标（`parseInt`），我们的浮点坐标会被解析成 `[0,0]-[0,0]`，从而在页首第一个文本块画一次会清空文字的退化高亮。插件会临时摘掉浮点 `selection=` 参数再交给原生处理（只保留页码跳转），并在 `textlayerrendered` 时兜底清理。
>
> **与 obsidian-pdf-plus 的不兼容**：PDF++ 的 `selection=` 是字符下标、`rect=` 是 FitR 视图参数；本插件的坐标语义不同，两边的高亮互不识别，混用时请留意。

## 安装

### 方式一：部署脚本（推荐）

```bash
npm install
npm run build
npm run deploy
```

部署脚本会从 `%APPDATA%\obsidian\obsidian.json` 读取 vault 列表：只有一个 vault 时直接用；多个时列出编号让你选择；也可以用 `--vault <路径>` 跳过选择：

```bash
npm run deploy -- --vault "F:\我的笔记库"
```

之后在 Obsidian 里「设置 → 第三方插件 → 重新载入（或重启）→ 启用 PDF 高亮链接」。

### 方式二：手动复制

把 `main.js`、`manifest.json`、`styles.css` 复制到：

```
<vault>\.obsidian\plugins\pdf-highlight-link\
```

### 方式三：从 GitHub Release 安装

1. 打开仓库的 Releases 页面，下载最新版本的 `main.js`、`manifest.json`、`styles.css`
2. 在 `<vault>/.obsidian/plugins/` 下新建 `pdf-highlight-link` 文件夹，把三个文件放进去
3. 重启 Obsidian，在「设置 → 第三方插件」里关闭限制模式并启用「PDF 高亮链接」

用 [BRAT](https://github.com/TfTHacker/obsidian42-brat) 也可以：在 BRAT 里「Add Beta plugin」填 `<GitHub 用户名>/obsidian-pdf-highlight-link`，之后随 Release 更新。

## 分发给其他人（Windows / macOS）

插件运行时是纯 JavaScript，没有平台相关代码，Windows 上构建的产物可以直接给 Windows 或 macOS 用户使用（对方不需要装 Node，也不需要在那台机器上开发）。

```bash
npm run build      # 生成 main.js
npm run package    # 产出 dist/pdf-highlight-link/ 和 dist/pdf-highlight-link-<版本>.zip
```

产物里包含 `main.js`、`manifest.json`、`styles.css` 和一份中文 `INSTALL.txt`；zip 由脚本自动生成，直接把 zip（或文件夹）发给对方即可。

对方安装步骤（同样写在 `INSTALL.txt` 里）：

**Windows 和 macOS 通用**

1. Obsidian → 设置 → 第三方插件 → 点「打开插件文件夹 / Open plugins folder」，会直接打开当前 vault 的 `.obsidian/plugins`
2. 把整个 `pdf-highlight-link` 文件夹复制进去（覆盖旧版同名文件夹即可）
3. 完全退出 Obsidian 再重新打开 → 设置 → 第三方插件 → 关闭限制模式 → 在已安装列表里启用「PDF 高亮链接」

**Windows 补充**

- 手动路径为 `<vault>\.obsidian\plugins\pdf-highlight-link\`；资源管理器默认隐藏点开头的文件夹，需要「查看 → 显示 → 隐藏的项目」
- 解压 zip 用右键「全部解压缩」，解压后应得到 `plugins\pdf-highlight-link\manifest.json`，不要出现 `pdf-highlight-link\pdf-highlight-link\` 或 `dist\...` 多套一层
- 不知道 vault 在哪时，`%APPDATA%\obsidian\obsidian.json` 里记录了所有 vault 的路径

**macOS 补充**

- Finder 里按 `Cmd + Shift + .` 显示隐藏文件；iCloud 的 vault 通常在 `~/Library/Mobile Documents/iCloud~md~obsidian/Documents/...`

注意：

- 仅 Obsidian **桌面版**可用（Windows / macOS / Linux），不支持手机和平板
- 对方不需要 Node，插件是普通 JS 文件，Windows SmartScreen / macOS Gatekeeper 都不会拦截
- 只想保留旧的颜色/透明度设置时，把旧插件目录里的 `data.json` 一起带上；打包产物默认不含 `data.json`
- 列表里看不到插件，通常是文件夹多套了一层；启用后没反应，先重启 Obsidian 并确认版本 ≥ 1.5

## 使用

1. 在 Obsidian 里打开一个 PDF（默认是「无模式」，你可以像平常一样浏览、选中、滚动）
2. 想取链接时，点工具栏右侧的「文字模式」或「框选模式」；再点一次同一个按钮就回到无模式（默认状态可在设置里改）
3. 文字模式下选中文字（或框选模式下拖出矩形），在浮动工具栏按需点「复制引用」或「复制链接」
4. 把内容粘贴到任意笔记（复制引用会得到一个可折叠的 callout 块）
5. 重新打开这个 PDF，高亮就会出现在对应位置；右侧面板会列出全部高亮，点条目跳页、点下方的小链接打开来源笔记并定位到那一行

## 开发

```bash
npm install --cache .npm-cache   # 依赖装在工作区内的缓存目录，避免污染全局 npm 缓存
npm run dev                      # esbuild 监听 + 生成 main.js
npm run build                    # tsc --noEmit 类型检查 + esbuild 生产构建
npm run test                     # 纯函数单元测试（链接解析/生成、坐标换算）
npm run smoke                    # 用打桩的 obsidian 模块加载 main.js，检查打包产物
```

目录结构：

```
src/
  main.ts                     插件入口：注册视图/命令/设置，管理刷新节奏
  types.ts                    共享类型 + 内置 PDF 组件的最小类型声明
  core/
    link.ts                   链接解析/生成、别名清洗、剪贴板（纯函数）
    geometry.ts               归一化矩形、页面内容盒换算（纯函数）
    backlink-index.ts         从 metadataCache 反向链接构建高亮索引
  viewer/
    pdf-viewer-api.ts         访问内置 PDF 组件、原生退化高亮抑制
    viewer-manager.ts         跟踪 PDF 叶子与笔记内嵌，维护绑定
    viewer-host.ts            区分「PDF 标签页 / 笔记内嵌」两种宿主
    viewer-binding.ts         单个 PDF 宿主的编排：模式、捕获、渲染、复制
    mode-buttons.ts           工具栏模式按钮
    float-toolbar.ts          选区浮动工具栏
    selection-capture.ts      文字选区 → 归一化矩形
    rect-capture.ts           拖拽框选 → 归一化矩形
    highlight-renderer.ts     页面内百分比覆盖层
  i18n/
    strings.ts                简繁英文案表、链接别名与原生别名识别
    detect.ts                 读取 Obsidian 界面语言（带旧版本回退）
  panel/highlight-panel-view.ts  右侧高亮面板
  settings/settings-tab.ts       设置页
test/
  run.ts                      单元测试
  smoke.cjs / obsidian-stub.cjs  打包产物冒烟测试
scripts/deploy.mjs            部署脚本
```

## 排查

命令面板执行「PDF 高亮链接：诊断 PDF 视图（输出到控制台）」，会在开发者控制台（`Ctrl+Shift+I`）打印每个 PDF 叶子的内部组件结构、事件总线来源、页面元素数量与绑定状态，用于确认内部 API 是否随 Obsidian 升级变化。

常见现象与原因：

- **高亮不自动重绘（缩略图/懒加载后）**：没有拿到事件总线。Obsidian 1.15 的 PDF 组件把总线挂在 `pdfViewer.eventBus` 上，而不是组件自身的 `eventBus`；插件已优先用前者，并回退到组件的 `on/off` 转发方法。仍失败时可手动执行「刷新高亮」。
- **关闭 PDF 标签页时报 `Cannot read properties of null (reading 'dom')`**：视图卸载时 PDF 组件会把 `pdfViewer` 置为 `null`。插件现在所有内部访问都先做 `isViewerAlive` 判活，清理流程逐步 try/catch，销毁已卸载视图时只降级不抛错。
- **刷新/重扫后旧绑定报错**：重新扫描时旧绑定可能已随视图卸载，销毁逻辑容忍空对象；同一叶子切换 PDF 文件会自动重建索引。

## 已知限制

- 文字高亮是**外接矩形**，不是逐行精确形状；多行选中会覆盖行间空白
- 面板的「来源笔记」链接会在新标签页打开笔记（已打开则直接切换过去），不会替换当前的 PDF 标签页
- 笔记内嵌 PDF 支持普通阅读视图、实时预览与画布；临时悬停预览（hover popover）不纳入面板与绑定。普通内嵌的模式按钮只在悬停/聚焦时显示，不占用 PDF 内容区域
- 高亮由反向链接推导：链接被删或改坏，高亮随之消失；不提供在 PDF 里直接编辑/删除高亮的界面
- 颜色与透明度是全局设置，不写进链接（同一链接在别的 vault 用默认颜色显示）
- 复制只写入剪贴板，不自动插入笔记
- 依赖 Obsidian 内部 PDF 组件（`pdf` 视图的私有字段），Obsidian 大版本升级后可能需要适配；所有访问都做了特征探测，缺失时降级而不是报错
- 部署脚本的交互选择需要真实终端（TTY），在 CI/管道里请用 `--vault`

## 版本记录

> 维护约定：每个版本的新增、变更与修复都追加在本节，不覆写旧版本记录。

### 0.2.0

**新增**

- 笔记内嵌 PDF：阅读视图、实时预览与画布中的 `![[file.pdf]]` 支持高亮、文字/框选、复制链接与右侧面板。
- 普通内嵌 PDF 的原生工具栏被 Obsidian 隐藏，新增 PDF 右上角的模式按钮 overlay（悬停/聚焦时显示）；画布内嵌优先使用原生工具栏。
- 多语言界面：命令、ribbon、PDF 工具栏、浮动工具栏、右侧面板、设置页与 Notice 支持简体中文 / 繁体中文 / 英文，未知语言回退英文。
- 链接别名按界面语言生成，并同时识别简繁英三种旧别名；新增语言归一化（含 `zh-Hant-TW`、`zh-Hans-CN` 等完整标签）。
- 诊断命令新增内嵌 PDF 绑定信息。

**变更**

- `ViewerBinding` 从“只依赖 WorkspaceLeaf”改为宿主抽象（`LeafViewerHost` / `EmbedViewerHost`），标签页与内嵌共用同一套交互与渲染逻辑。
- 内嵌 PDF 复制链接时按包含它的笔记解析相对路径。
- README 与安装说明补充内嵌 PDF 和语言切换说明；移除“不支持内嵌”的旧限制。

**修复**

- `Component.addChild` 捕获钩子改为定位真正 own 该方法的原型，避免只挂到插件子类原型而漏掉 Obsidian 创建的内嵌。
- 内嵌模式按钮隐藏时禁用指针事件，避免透明按钮挡住 PDF 点击。
- 高亮 tooltip、复制成功/失败提示等剩余硬编码文案接入 i18n。

### 0.1.0

- 首个版本：PDF 标签页文字/框选高亮、复制引用/链接、右侧高亮面板、颜色/透明度/默认模式设置。

## License

MIT
