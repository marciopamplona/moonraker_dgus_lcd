import { defineConfig, type Plugin } from "vite";
import preact from "@preact/preset-vite";

/** Inline the JS and CSS into index.html, so dist/index.html also works when
 * opened from file:// (browsers block module scripts from file URLs). */
function singleFile(): Plugin {
  return {
    name: "single-file",
    enforce: "post",
    generateBundle(_, bundle) {
      const html = Object.values(bundle).find((f) => f.fileName === "index.html");
      if (!html || html.type !== "asset") return;
      let src = String(html.source);
      for (const [name, f] of Object.entries(bundle)) {
        if (f.type === "chunk" && f.isEntry) {
          const code = f.code.replace(/<\/script/gi, "<\\/script");
          src = src.replace(new RegExp(`<script[^>]*src="[^"]*${name}"[^>]*></script>`),
            () => `<script type="module">${code}</script>`);
          delete bundle[name];
        } else if (f.type === "asset" && name.endsWith(".css")) {
          src = src.replace(new RegExp(`<link[^>]*href="[^"]*${name}"[^>]*>`),
            () => `<style>${String(f.source)}</style>`);
          delete bundle[name];
        }
      }
      html.source = src;
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [preact(), singleFile()],
  build: { outDir: "dist", emptyOutDir: true, modulePreload: false },
});
