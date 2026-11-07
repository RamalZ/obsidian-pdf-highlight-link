import esbuild from "esbuild";

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

/** @type {import("esbuild").BuildOptions} */
const options = {
  entryPoints: ["src/main.ts"],
  bundle: true,
  // Obsidian 提供的运行时模块不打包
  external: ["obsidian", "electron", "@codemirror/*", "@lezer/*"],
  format: "cjs",
  target: "es2018",
  platform: "browser",
  logLevel: "info",
  treeShaking: true,
  outfile: "main.js",
  sourcemap: production ? false : "inline",
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log("[pdfhl] 监听 src/ 变更中…");
} else {
  const ctx = await esbuild.context(options);
  await ctx.rebuild();
  await ctx.dispose();
}
