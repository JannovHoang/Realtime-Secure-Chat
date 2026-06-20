// vite.config.js (CommonJS config - works without "type":"module")
const path = require("path");
const { defineConfig } = require("vite");

const cryptoShim = path.resolve(__dirname, "client", "shims", "crypto.js");

module.exports = defineConfig({
  // UI entry lives here
  root: path.resolve(__dirname, "client", "ui"),
  // Keep runtime configuration in the project root .env even though the UI root
  // is client/ui. Vite only exposes VITE_* values to the browser bundle.
  envDir: __dirname,

  server: {
    port: 5173,
    // (Optional) nếu bạn muốn sau này đổi WS_URL thành "/ws" và proxy qua Vite:
    // proxy: {
    //   "/ws": {
    //     target: "ws://localhost:3000",
    //     ws: true,
    //   },
    // },
  },

  // Build output to /dist at project root
  build: {
    outDir: path.resolve(__dirname, "dist"),
    emptyOutDir: true,
    sourcemap: true,
  },

  // Safer alias: exact match only
  resolve: {
    alias: [
      { find: /^crypto$/, replacement: cryptoShim },
      { find: /^node:crypto$/, replacement: cryptoShim },
    ],
  },
});
