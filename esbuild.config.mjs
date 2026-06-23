import esbuild from "esbuild";
const prod = process.argv[2] === "production";
const ctx = await esbuild.context({
  entryPoints: ["src/main.ts"], bundle: true, format: "cjs",
  target: "es2020", external: ["obsidian", "electron"],
  outfile: "main.js", sourcemap: prod ? false : "inline", logLevel: "info",
  inject: ["./scripts/polyfills.mjs"],
});
if (prod) { await ctx.rebuild(); process.exit(0); } else { await ctx.watch(); }
