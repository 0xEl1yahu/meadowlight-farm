/**
 * Post-build check (farmclaws part 3 spec §10.1 and §10.3, part 4b spec §10) on the normal build in dist/:
 * - gzip budgets (zlib level 6): the lazy Blockly editor ≤ 250 KiB, the lazy robot screen
 *   ≤ 40 KiB, the lazy shops ≤ 20 KiB, the main entry chunk ≤ the part 2 baseline
 *   (scripts/bundle-baseline.json) + 26 KiB;
 * - the robot screen and the shops each a lazy chunk of their own, and Blockly in neither of them
 *   nor the main chunk (by each source map's `sources`);
 * - no dev-hook name in any file of dist/, source maps included.
 * Prints a table of sizes and exits 1 with a sentence per problem.
 *
 * Usage: npm run build:check   (npm run build && node scripts/check-bundle.mjs)
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import {
  DEV_HOOK_WORDS,
  budgetProblems,
  classifyChunks,
  devHookMatches,
  entryScriptPath,
  evaluateBudgets,
  formatKiB,
} from './bundleRules.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const problems = [];

/** Every file under `dir`, recursively, sorted. */
function listFiles(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => (entry.isDirectory() ? listFiles(join(dir, entry.name)) : [join(dir, entry.name)]))
    .sort();
}

const baseline = JSON.parse(readFileSync(join(root, 'scripts', 'bundle-baseline.json'), 'utf8'));
if (!Number.isInteger(baseline.mainGzipBytes) || baseline.mainGzipBytes <= 0) {
  problems.push('scripts/bundle-baseline.json needs a positive integer mainGzipBytes.');
}

const entry = entryScriptPath(readFileSync(join(dist, 'index.html'), 'utf8'));

const chunks = readdirSync(join(dist, 'assets'))
  .filter((name) => name.endsWith('.js'))
  .sort()
  .map((name) => {
    const file = `assets/${name}`;
    const mapPath = join(dist, `${file}.map`);
    const unmapped = !existsSync(mapPath);
    const sources = unmapped ? [] : (JSON.parse(readFileSync(mapPath, 'utf8')).sources ?? []);
    return { file, gzipBytes: gzipSync(readFileSync(join(dist, file))).length, sources, unmapped };
  });

const roles = classifyChunks(chunks, entry);
problems.push(...roles.problems);
const rows = evaluateBudgets(roles, baseline.mainGzipBytes);
problems.push(...budgetProblems(rows));

console.log('check-bundle: gzipped sizes (zlib level 6)');
console.log(`  ${'role'.padEnd(8)}${'gzip'.padStart(12)}${'limit'.padStart(12)}  result  files`);
for (const row of rows) {
  console.log(`  ${row.role.padEnd(8)}${formatKiB(row.gzipBytes).padStart(12)}${formatKiB(row.limitBytes).padStart(12)}  ${(row.ok ? 'ok' : 'OVER').padEnd(6)}  ${row.files.join(', ')}`);
}
for (const chunk of roles.other) {
  console.log(`  ${'other'.padEnd(8)}${formatKiB(chunk.gzipBytes).padStart(12)}${'-'.padStart(12)}  ${'-'.padEnd(6)}  ${chunk.file}`);
}

const files = listFiles(dist).map((path) => ({ path: relative(dist, path).split(sep).join('/'), text: readFileSync(path, 'utf8') }));
const hooks = devHookMatches(files);
for (const hit of hooks) {
  problems.push(`dist/${hit.path} contains ${hit.words.join(', ')}. Dev-hook names and text stay in src/dev/ (comments too: source maps carry them).`);
}
console.log(`check-bundle: ${files.length} files in dist/ checked for ${DEV_HOOK_WORDS.join('|')}: ${hooks.length === 0 ? 'none found' : `${hooks.length} found`}`);

if (problems.length > 0) {
  console.error('check-bundle: FAILED');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log('check-bundle: OK');
