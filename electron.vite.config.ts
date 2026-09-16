import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const rcip = resolve(__dirname, 'packages/rcip/src/index.ts');

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ['@trxcontroller/rcip'] })],
    resolve: { alias: { '@trxcontroller/rcip': rcip } },
    // RadioReference application key, baked in at build time. Absent (empty) in
    // builds made without RR_KEY, which disables the RadioReference features.
    define: { __RR_APP_KEY__: JSON.stringify(process.env['RR_KEY'] ?? '') },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@renderer': resolve(__dirname, 'src/renderer/src'),
        '@trxcontroller/rcip': rcip,
      },
    },
  },
});
