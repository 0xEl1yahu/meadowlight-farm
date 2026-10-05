import { defineConfig } from 'vitest/config';

export default defineConfig(({ mode }) => ({
  build: {
    target: 'es2022',
    sourcemap: true,
    // The single-file build carries the robot screen and Blockly inside its one script.
    chunkSizeWarningLimit: mode === 'single' ? 4000 : 1500,
    // `npm run build:single` (farmclaws part 3 spec §10.2): every dynamic import is inlined into the
    // entry script, so scripts/build-single.mjs inlines the robot screen and the editor with it.
    // `codeSplitting: false` is Rolldown's name for Rollup's `inlineDynamicImports: true`.
    ...(mode === 'single' ? { rolldownOptions: { output: { codeSplitting: false } } } : {}),
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30000,
  },
}));
