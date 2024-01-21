import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/main.ts', 'src/db/sqlite/migrate.ts', 'src/db/sqlite/migrations/001-init.ts'],
  sourcemap: true,
  clean: true,
  shims: true,
  dts: true,
  format: 'esm',
  outDir: 'dist',
  platform: 'node',
  splitting: true,
});
