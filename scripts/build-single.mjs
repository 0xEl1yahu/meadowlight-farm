/**
 * Post-build step: inlines the Vite bundle (JS + CSS) into a single self-contained HTML file,
 * dist-single/index.html, so the playable build can be shared as one page.
 *
 * Usage: npm run build && node scripts/build-single.mjs
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const outDir = join(root, 'dist-single');

let html = readFileSync(join(dist, 'index.html'), 'utf8');

const readAsset = (href) => readFileSync(join(dist, href.replace(/^\//, '')), 'utf8');

html = html.replace(/<script type="module" crossorigin src="([^"]+)"><\/script>/g, (_match, src) => {
  const code = readAsset(src)
    .replace(/\/\/# sourceMappingURL=\S+\s*$/m, '')
    .replace(/<\/script/gi, '<\\/script');
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
console.log(`build-single: wrote ${join(outDir, 'index.html')} (${(html.length / 1024).toFixed(1)} KiB)`);
