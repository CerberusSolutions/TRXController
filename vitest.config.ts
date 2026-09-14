import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@trxcontroller/rcip': resolve(__dirname, 'packages/rcip/src/index.ts') } },
  test: {
    include: ['packages/**/src/**/*.test.ts', 'src/main/**/*.test.ts'],
    environment: 'node',
  },
});
