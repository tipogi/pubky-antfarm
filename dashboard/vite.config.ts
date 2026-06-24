import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";

/** @synonymdev/pkarr ships a Node-only bundle (CJS exports + fs.readFileSync). */
function pkarrBrowser(): Plugin {
  return {
    name: "pkarr-browser",
    enforce: "pre",
    transform(code, id) {
      if (!id.includes("@synonymdev/pkarr/index.js")) {
        return null;
      }

      let out = code.replace(/^exports\.\w+ = \w+;\n/gm, "");
      out = out.replace(
        /const wasmPath = `\$\{__dirname\}\/pkarr_js_bg\.wasm`;\nconst wasmBytes = require\('fs'\)\.readFileSync\(wasmPath\);\nconst wasmModule = new WebAssembly\.Module\(wasmBytes\);\nlet wasmInstance = new WebAssembly\.Instance\(wasmModule, __wbg_get_imports\(\)\);\nlet wasm = wasmInstance\.exports;\nwasm\.__wbindgen_start\(\);\nexport default imports\nglobalThis\['pubky'\] = imports\n?/,
        `import pkarrWasmUrl from "./pkarr_js_bg.wasm?url";
const wasmModule = await WebAssembly.compileStreaming(fetch(pkarrWasmUrl));
const wasmInstance = new WebAssembly.Instance(wasmModule, __wbg_get_imports());
let wasm = wasmInstance.exports;
wasm.__wbindgen_start();
`
      );

      return { code: out, map: null };
    },
  };
}

// The antfarm dashboard API runs on 127.0.0.1:6400 (config: dashboard_addr).
// Proxy /api there so the SPA and the SSE stream share an origin in dev.
export default defineConfig({
  plugins: [pkarrBrowser(), wasm(), topLevelAwait(), react()],
  optimizeDeps: {
    exclude: ["@synonymdev/pkarr"],
  },
  resolve: {
    alias: {
      "@synonymdev/pkarr": "@synonymdev/pkarr/index.js",
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:6400",
        changeOrigin: true,
      },
    },
  },
});
