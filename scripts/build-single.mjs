/**
 * Post-build step: inlines the Vite bundle (JS + CSS) into a single HTML page,
 * dist-single/index.html, so the playable build can be shared as one page. It expects the
 * `single` build mode (vite.config.ts), which inlines every dynamic import into the entry
 * script, and fails if a lazy chunk is still imported from assets/ (farmclaws part 3 spec §10.2).
 * Blockly's sprites and cursors (public/blockly-media) are copied beside the page: the game runs
 * from index.html alone, and the editor's trash can and zoom icons need the folder next to it.
 *
 * Usage: npm run build:single   (vite build --mode single && node scripts/build-single.mjs)
 */
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lazyImportLeft } from './bundleRules.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const outDir = join(root, 'dist-single');

let html = readFileSync(join(dist, 'index.html'), 'utf8');

const readAsset = (href) => readFileSync(join(dist, href.replace(/^\//, '')), 'utf8');

html = html.replace(/<script type="module" crossorigin src="([^"]+)"><\/script>/g, (_match, src) => {
  const code = readAsset(src)
    .replace(/\/\/# sourceMappingURL=\S+\s*$/m, '')
    .replace(/<\/script/gi, '<\\/script');
  const lazy = lazyImportLeft(code);
  if (lazy !== null) {
    throw new Error(`build-single: ${src} still loads a lazy chunk with ${lazy}. Build with \`vite build --mode single\` so dynamic imports are inlined.`);
  }
  return `<script type="module">\n${code}\n</script>`;
});

html = html.replace(/<link rel="stylesheet" crossorigin href="([^"]+)">/g, (_match, href) => {
  const css = readAsset(href).replace(/\/\*# sourceMappingURL=\S+\s*\*\//g, '');
  return `<style>\n${css}\n</style>`;
});

html = html.replace(/<link rel="modulepreload"[^>]*>/g, '');

if (/src="\/assets\//.test(html) || /href="\/assets\//.test(html)) {
  throw new Error('build-single: some /assets/ references were not inlined');
}

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'index.html'), html);
const media = join(dist, 'blockly-media');
if (!existsSync(media)) throw new Error('build-single: dist/blockly-media is missing (public/blockly-media, Task 12)');
cpSync(media, join(outDir, 'blockly-media'), { recursive: true });
console.log(`build-single: wrote ${join(outDir, 'index.html')} (${(html.length / 1024).toFixed(1)} KiB)`);
