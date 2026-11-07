# PDF Highlight Link

**English** | [简体中文](README.zh-CN.md)

Select text or drag a rectangle in Obsidian's built-in PDF viewer — in a PDF tab or embedded in a note — copy a Markdown link to that spot, paste it into a note, and the next time you open that PDF the highlight is drawn right there.

- The PDF file is never modified; highlights are derived entirely from backlinks
- Reuses Obsidian's bundled PDF.js viewer, no third-party runtime dependencies
- Desktop only (Obsidian 1.5+; tested with 1.15.0)

## Features

- **Three-state mode**: the default is **off** — the PDF behaves exactly like the stock viewer. Click **Text mode** or **Rectangle mode** on the right side of the toolbar to enter a mode; click the same button (or press `T` in text mode) to go back to off.
- **Embedded PDFs**: PDFs embedded with `![[file.pdf]]` support the same highlights, text/rectangle modes, link copying, and sidebar panel. Obsidian hides the native toolbar for ordinary embeds, so the plugin shows its mode buttons in the PDF's top-right corner on hover/focus, automatically to the left of the native three-dot menu and edit-block button; canvas embeds keep the native toolbar.
- **Text mode**: select text → a floating toolbar appears → **Copy reference** or **Copy link**
- **Rectangle mode**: drag a rectangle → release → the same floating toolbar appears
- **Copy reference** mirrors Obsidian's native PDF reference — a quote line, an empty line, then the link. For text selections the selected text becomes the quote line; for rectangles a placeholder sentence is emitted for you to fill in:

  ```markdown
  > the piece of text you selected

  [[paper.pdf#page=3&selection=0.12,0.34,0.56,0.35|paper.pdf, page 3]]
  ```

  ```markdown
  > (Describe the region content here)

  [[paper.pdf#page=5&rect=0.1,0.2,0.3,0.4|paper.pdf, page 5]]
  ```

- **Copy link** copies just the `[[file.pdf#page=...|file.pdf, 第 X 页]]` link
- **Highlight rendering**: on open, backlinks are read from `metadataCache`, `page` / `selection` / `rect` are parsed, and overlays are drawn on the page
- **Sidebar panel**: all highlights of the current PDF grouped by page (color dot, snippet, source note), with a search filter. Click an entry to jump to the page and flash it; click the small link underneath to open the source note at that line
- **Settings**: default mode (off / text / rectangle), highlight color (yellow / green / blue / pink), opacity
- **Localized UI**: commands, ribbon, toolbar buttons, floating toolbar, sidebar panel, settings, and notices follow Obsidian's interface language (Simplified Chinese / Traditional Chinese / English); unsupported languages fall back to English

## Link format

Text selection (the coordinates are two **opposite corners**):

```
[[file.pdf#page=3&selection=0.12,0.34,0.56,0.35|file.pdf, page 3]]
```

Rectangle selection (the coordinates are **top-left corner + width/height**):

```
[[file.pdf#page=5&rect=0.12,0.34,0.21,0.08|file.pdf, page 5]]
```

Coordinates are always **ratios of the page content box (0–1, four decimals)**, never pixels, so they survive zooming, panning and different screens. Multi-line selections use the bounding box of all lines; selections spanning pages are anchored to the first page.

The alias produced by both **Copy reference** and **Copy link** follows the current interface language: Simplified Chinese `文件.pdf, 第 X 页`, Traditional Chinese `檔案.pdf, 第 X 頁`, or English `file.pdf, page X` (matching Obsidian's native PDF reference). The selected text therefore does not occupy the alias — the panel reads text snippets back from the quote line above the link. Links in all three formats are recognized.

> **Relationship to native Obsidian PDF links**: the native parser treats `selection=` as character indices (`parseInt`), so our floating-point coordinates would degrade to `[0,0]-[0,0]` and paint a text-erasing highlight on the first text block of the page. The plugin temporarily strips the floating-point `selection=` parameter before handing the subpath to the native viewer (page navigation is preserved) and clears any degenerate highlight on `textlayerrendered`.
>
> **Incompatible with obsidian-pdf-plus**: in PDF++, `selection=` holds character indices and `rect=` is a FitR view parameter. The coordinate semantics differ, so the two plugins do not recognize each other's highlights.

## Installation

### Option 1: deploy script (for development)

```bash
npm install
npm run build
npm run deploy
```

The script reads the vault list from `%APPDATA%\obsidian\obsidian.json`: with a single vault it is used directly, with several you pick one by number. Pass `--vault <path>` to skip the prompt:

```bash
npm run deploy -- --vault "F:\MyVault"
```

Then in Obsidian: **Settings → Community plugins → Reload (or restart) → enable “PDF Highlight Link”**.

### Option 2: copy the files manually

Copy `main.js`, `manifest.json` and `styles.css` into:

```
<vault>/.obsidian/plugins/pdf-highlight-link/
```

### Option 3: install from a GitHub Release

1. Open the repository's Releases page and download `main.js`, `manifest.json` and `styles.css` from the latest release
2. Create `.obsidian/plugins/pdf-highlight-link/` inside your vault and put the three files there
3. Restart Obsidian, turn off Restricted mode under **Settings → Community plugins**, and enable “PDF Highlight Link”

You can also use [BRAT](https://github.com/TfTHacker/obsidian42-brat): *Add Beta plugin* → `RamalZ/obsidian-pdf-highlight-link`, and it will update with each release.

## Sharing with other people (Windows / macOS)

The plugin is plain JavaScript with no platform-specific code, so a build made on Windows works for Windows and macOS alike (the other person does not need Node, nor does the plugin need to be developed there).

```bash
npm run build      # produces main.js
npm run package    # produces dist/pdf-highlight-link/ and dist/pdf-highlight-link-<version>.zip
```

The output contains `main.js`, `manifest.json`, `styles.css` and a Chinese `INSTALL.txt`; the zip is generated by the script, so you can just send the zip (or the folder).

Recipient steps (the same text is in `INSTALL.txt`):

**Windows and macOS**

1. Obsidian → Settings → Community plugins → **Open plugins folder**, which opens `.obsidian/plugins` for the current vault
2. Copy the whole `pdf-highlight-link` folder in (overwrite an older one with the same name)
3. Quit Obsidian completely and reopen it → Settings → Community plugins → turn off Restricted mode → enable “PDF Highlight Link”

**Windows notes**

- Manual path: `<vault>\.obsidian\plugins\pdf-highlight-link\`; Explorer hides dot-folders by default, so enable *View → Show → Hidden items*
- Extract the zip with *Extract All*; the result must be `plugins\pdf-highlight-link\manifest.json`, never `pdf-highlight-link\pdf-highlight-link\` or `dist\...`
- If you don't know where the vault is, `%APPDATA%\obsidian\obsidian.json` lists every vault path

**macOS notes**

- Press `Cmd + Shift + .` in Finder to show hidden files; iCloud vaults usually live under `~/Library/Mobile Documents/iCloud~md~obsidian/Documents/...`

Notes:

- Obsidian **desktop** only (Windows / macOS / Linux); phones and tablets are not supported
- The recipient does not need Node; the plugin is ordinary JS and is not blocked by SmartScreen or Gatekeeper
- To keep old color/opacity settings, carry over `data.json` from the previous plugin folder; the package intentionally excludes it
- If the plugin does not appear in the list, the folder is usually nested one level too deep; if enabling does nothing, restart Obsidian and check that the version is ≥ 1.5

## Usage

1. Open a PDF in Obsidian (the default mode is off, so you can browse, select and scroll as usual)
2. To capture a link, click **Text mode** or **Rectangle mode** on the toolbar; click again to return to off (the default can be changed in settings)
3. In text mode select text (in rectangle mode drag a rectangle), then click **Copy reference** or **Copy link** in the floating toolbar
4. Paste into any note (Copy reference produces a collapsible callout-style block)
5. Reopen the PDF and the highlight is drawn at the position; the sidebar panel lists every highlight — click an entry to jump, click the small link to open the source note at that line

## Development

```bash
npm install --cache .npm-cache   # keep the npm cache inside the workspace
npm run dev                      # esbuild watch + emit main.js
npm run build                    # tsc --noEmit + production esbuild
npm run test                     # unit tests for the pure functions (link parsing/building, geometry)
npm run smoke                    # load main.js against a stubbed obsidian module
```

Layout:

```
src/
  main.ts                     plugin entry: views, commands, settings, refresh scheduling
  types.ts                    shared types + minimal typings for Obsidian's internal PDF component
  core/
    link.ts                   link parsing/building, alias sanitizing, clipboard (pure)
    geometry.ts               normalized rectangles, page content-box math (pure)
    backlink-index.ts         build the highlight index from metadataCache backlinks
  viewer/
    pdf-viewer-api.ts         access the internal PDF component, suppress the degenerate native highlight
    viewer-manager.ts         track PDF leaves and embedded PDFs, maintain bindings
    viewer-host.ts            distinguish PDF-leaf and embedded-PDF hosts
    viewer-binding.ts         per-host orchestration: mode, capture, rendering, copying
    mode-buttons.ts           toolbar mode buttons
    float-toolbar.ts          floating toolbar for selections
    selection-capture.ts      text selection → normalized rectangle
    rect-capture.ts           drag selection → normalized rectangle
    highlight-renderer.ts     percentage overlay inside each page
  i18n/
    strings.ts                Simplified Chinese / Traditional Chinese / English strings, link aliases, native-alias detection
    detect.ts                 read Obsidian's interface language with fallbacks for older versions
  panel/highlight-panel-view.ts  sidebar highlight panel
  settings/settings-tab.ts       settings tab
test/
  run.ts                      unit tests
  smoke.cjs / obsidian-stub.cjs  bundle smoke test
scripts/deploy.mjs            deploy script
```

## Troubleshooting

Run **“PDF Highlight Link: Diagnose PDF view (log to console)”** from the command palette. It prints each PDF leaf's internal component structure, the event-bus source, the number of page elements and the binding state to the developer console (`Ctrl+Shift+I`), which tells you whether the internal APIs have changed with an Obsidian upgrade.

Common symptoms and causes:

- **Highlights stop repainting after thumbnail scrolling / lazy loading**: the event bus was not found. In Obsidian 1.15 the PDF component exposes it as `pdfViewer.eventBus`, not on the component itself; the plugin prefers that and falls back to the component's `on/off` forwarders. If it still fails, run **Refresh highlights** manually.
- **`Cannot read properties of null (reading 'dom')` when closing a PDF tab**: on unload the PDF component nulls `pdfViewer`. Every internal access now goes through `isViewerAlive`, cleanup steps are wrapped in try/catch, and destroying an unloaded view degrades instead of throwing.
- **Errors from stale bindings after a rescan**: a rebind may find a view that has already been unloaded; the destroy path tolerates empty objects, and switching files within the same leaf rebuilds the index automatically.

## Known limitations

- Text highlights are **bounding rectangles**, not per-line shapes; multi-line selections cover the gaps between lines
- The panel's source-note link opens the note in a new tab (or switches to it if already open) and never replaces the current PDF tab
- Embedded PDFs are supported in reading view, Live Preview, and canvas; temporary hover previews are excluded from the panel and bindings. For ordinary embeds, the mode buttons appear only on hover/focus and automatically avoid the native three-dot menu and edit-block button; in a very narrow container they stay inside the PDF's left edge
- Highlights come from backlinks: delete or break a link and its highlight disappears; there is no in-PDF editor for editing or deleting highlights
- Color and opacity are global settings, not encoded in the link (the same link shows in the default color in another vault)
- Copying only writes to the clipboard; nothing is inserted into a note automatically
- The plugin depends on Obsidian's internal PDF component (private fields of the `pdf` view) and may need adaptation after a major upgrade; every access is feature-detected and degrades instead of throwing
- The deploy script's interactive picker needs a real TTY; use `--vault` in CI or pipelines

## Changelog

> Maintenance rule: append each release's additions, changes, and fixes here; do not overwrite older release notes.

### 0.2.3

**Changed**

- Plugin display name is now **PDF Highlight Link** (previously `PDF 高亮链接`). The plugin id `pdf-highlight-link`, settings data, link format, and highlight index are unchanged, so no migration is needed.
- Updated the install/deploy instructions, packaged `INSTALL.txt`, stylesheet header, and command-palette example to use the English name.

**Fixed**

- The packaged `INSTALL.txt` now tells users to search for **高亮面板** in the command palette instead of the old `PDF 高亮` prefix.

### 0.2.2

**Changed**

- Corrected the 0.2.0 note: the `.pdf-toolbar` of an ordinary embed is normally visible on screen; `display:none` applies only to print media. The overlay is kept and now avoids the whole top-right group of native controls.

**Fixed**

- Mode buttons for ordinary embedded PDFs now avoid both the `.pdf-toolbar-right` three-dot menu and the `.embed-actions` edit-block button. Positioning uses the leftmost visible top-right native control instead of only `.embed-actions`; the offset is recomputed when the container or toolbar resizes, with a 72px fallback when measurement fails.

### 0.2.1

**Changed**

- README now documents the versioning rule: patches for existing-behavior improvements (0.0.0 → 0.0.1), minor bumps for new features (0.0.0 → 0.1.0); every change is committed and pushed to GitHub.

**Fixed**

- Mode buttons for ordinary embedded PDFs now shift left based on the actual position of the native `.embed-actions`, keeping the three-dot menu and edit-block button accessible. The offset is recomputed when the container resizes, with a 72px fallback when measurement fails.

### 0.2.0

**Added**

- Embedded PDFs: `![[file.pdf]]` in reading view, Live Preview, and canvas now supports highlights, text/rectangle modes, link copying, and the sidebar panel.
- Obsidian hides the native toolbar for ordinary embeds, so mode buttons are shown in a top-right overlay (on hover/focus); canvas embeds keep the native toolbar.
- Localized UI: commands, ribbon, PDF toolbar, floating toolbar, sidebar panel, settings, and notices support Simplified Chinese / Traditional Chinese / English, with English as the fallback.
- Link aliases follow the interface language, while links in all three alias formats remain recognized; locale normalization now handles full tags such as `zh-Hant-TW` and `zh-Hans-CN`.
- The diagnose command now reports embedded-PDF bindings.

**Changed**

- `ViewerBinding` no longer assumes a `WorkspaceLeaf`; it uses a host abstraction (`LeafViewerHost` / `EmbedViewerHost`) so tabs and embeds share the same interaction and rendering logic.
- Link copying for an embedded PDF resolves the relative path from the note that contains it.
- README and installation guide now cover embedded PDFs and language switching; the old “embedded PDFs are not supported” limitation was removed.

**Fixed**

- The `Component.addChild` capture hook now targets the prototype that actually owns the method, instead of stopping at the plugin subclass prototype and missing Obsidian-created embeds.
- Hidden embedded-mode controls no longer intercept pointer events.
- Remaining hardcoded strings in highlight tooltips and copy success/failure notices now use i18n.

### 0.1.0

- Initial release: text/rectangle highlights in PDF tabs, copy reference/link, sidebar highlight panel, and color/opacity/default-mode settings.

## License

MIT
