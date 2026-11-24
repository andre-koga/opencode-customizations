import { defineConfig } from '../../plan-renderer/node_modules/vite/dist/node/index.js'
import solid from '../../plan-renderer/node_modules/vite-plugin-solid/dist/esm/index.mjs'
import { fileURLToPath } from 'node:url'

const path = (value) => fileURLToPath(new URL(value, import.meta.url))
export default defineConfig({
  root: path('.'), plugins: [solid()],
  resolve: { alias: [
    { find: /^@opencode\/plugin\/gui(?:\/browser)?$/, replacement: path('./sdk.tsx') },
    { find: /^node:(?:child_process|util)$/, replacement: path('./node.ts') },
    { find: 'solid-js', replacement: path('../../plan-renderer/node_modules/solid-js') },
    { find: /^effect$/, replacement: path('./sdk.tsx') },
  ] },
  server: { host: '127.0.0.1', port: 4198, strictPort: true, fs: { allow: [path('../..')] } },
})
