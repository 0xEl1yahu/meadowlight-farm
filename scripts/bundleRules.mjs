/**
 * The rules behind scripts/check-bundle.mjs (farmclaws part 3 spec §10), kept free of Node APIs
 * so tests/checkBundle.test.ts can run them on made-up chunks. Sizes are gzipped bytes.
 */

export const KIB = 1024;

/** Spec §10.1: the lazy Blockly editor, the lazy robot screen, and the main chunk's growth over the part 2 baseline. */
export const EDITOR_MAX_GZIP = 250 * KIB;
export const SCREEN_MAX_GZIP = 40 * KIB;
export const MAIN_GROWTH_MAX_GZIP = 16 * KIB;
/** A chunk without a source map is only tolerated up to this size (bundler runtime helpers); it still gets the dev-hook grep. */
export const UNMAPPED_MAX_GZIP = 1 * KIB;

/** A chunk whose source map lists a path containing this holds Blockly. */
export const BLOCKLY_SOURCE = 'node_modules/blockly/';
/** The chunk whose source map lists a path ending in this is the robot screen chunk. */
export const SCREEN_SOURCE = 'src/ui/robotScreen/RobotScreen.ts';
/** Spec §10.3: names only the dev hooks use. `setProgram` is left out: three.js's WebGLRenderer has its own. */
export const DEV_HOOK_WORDS = ['robotLog', 'installRobotDev', 'addScriptedRobot', 'setMd', 'setZone', 'unlockAll'];

const slashes = (path) => path.replace(/\\/g, '/');
const blocklySources = (chunk) => chunk.sources.filter((s) => slashes(s).includes(BLOCKLY_SOURCE));
const holdsScreen = (chunk) => chunk.sources.some((s) => slashes(s).endsWith(SCREEN_SOURCE));

/** "275.5 KiB". */
export function formatKiB(bytes) {
  return `${(bytes / KIB).toFixed(1)} KiB`;
}

/** The entry script's path inside dist/ ("assets/index-abc.js"), read from dist/index.html; null when there is none. */
export function entryScriptPath(html) {
  const match = /<script\b[^>]*\btype="module"[^>]*\bsrc="\/?([^"]+\.js)"[^>]*><\/script>/.exec(html);
  return match === null ? null : (match[1] ?? null);
}

/**
 * Sorts the built chunks into the main entry chunk, the robot screen chunk, the editor chunks
 * (every other chunk holding Blockly: `blockly/core` and `blockly/msg/en` may land in separate
 * chunks) and the rest, and lists every placement problem.
 *
 * @param {readonly { file: string, gzipBytes: number, sources: readonly string[], unmapped?: boolean }[]} chunks
 * @param {string | null} entryFile the entry script's path inside dist/
 */
export function classifyChunks(chunks, entryFile) {
  const problems = [];
  const main = chunks.find((c) => c.file === entryFile) ?? null;
  if (main === null) {
    problems.push(entryFile === null ? 'dist/index.html has no <script type="module" src="…"> entry.' : `The entry script ${entryFile} isn't in dist/assets.`);
  }

  for (const chunk of chunks) {
    if (chunk.unmapped === true && chunk.gzipBytes > UNMAPPED_MAX_GZIP) {
      problems.push(`${chunk.file} has no source map, so its modules can't be checked. Keep build.sourcemap on.`);
    }
  }

  let screen = null;
  if (main !== null && holdsScreen(main)) {
    problems.push(`The robot screen is in the main chunk (${main.file}). Load ${SCREEN_SOURCE} only through import().`);
  } else {
    screen = chunks.find((c) => holdsScreen(c)) ?? null;
    if (screen === null) problems.push(`No chunk's source map lists ${SCREEN_SOURCE}. The robot screen must be a lazy chunk of its own.`);
  }

  let blocklyMisplaced = false;
  for (const [role, chunk] of [['main', main], ['screen', screen]]) {
    if (chunk === null) continue;
    const found = blocklySources(chunk);
    if (found.length === 0) continue;
    blocklyMisplaced = true;
    problems.push(`Blockly is in the ${role} chunk (${chunk.file}), e.g. ${found[0]}. Import blockly only through import() inside src/ui/robotScreen/.`);
  }

  const editor = chunks.filter((c) => c !== main && c !== screen && blocklySources(c).length > 0);
  if (editor.length === 0 && !blocklyMisplaced) {
    problems.push(`No lazy chunk's source map lists ${BLOCKLY_SOURCE}. The Program tab must load blockly through import().`);
  }
  const other = chunks.filter((c) => c !== main && c !== screen && !editor.includes(c));
  return { main, screen, editor, other, problems };
}

/**
 * One row per budget that has a chunk to measure: main (baseline + growth), screen and editor
 * (the editor chunks' sizes added up).
 *
 * @param {{ main: { file: string, gzipBytes: number } | null, screen: { file: string, gzipBytes: number } | null, editor: readonly { file: string, gzipBytes: number }[] }} roles
 * @param {number} baselineMainGzip the part 2 main chunk, from scripts/bundle-baseline.json
 */
export function evaluateBudgets(roles, baselineMainGzip) {
  const rows = [];
  if (roles.main !== null) {
    rows.push({ role: 'main', files: [roles.main.file], gzipBytes: roles.main.gzipBytes, limitBytes: baselineMainGzip + MAIN_GROWTH_MAX_GZIP });
  }
  if (roles.screen !== null) {
    rows.push({ role: 'screen', files: [roles.screen.file], gzipBytes: roles.screen.gzipBytes, limitBytes: SCREEN_MAX_GZIP });
  }
  if (roles.editor.length > 0) {
    const gzipBytes = roles.editor.reduce((sum, c) => sum + c.gzipBytes, 0);
    rows.push({ role: 'editor', files: roles.editor.map((c) => c.file), gzipBytes, limitBytes: EDITOR_MAX_GZIP });
  }
  return rows.map((row) => ({ ...row, ok: row.gzipBytes <= row.limitBytes }));
}

/** A sentence for each row over its budget. */
export function budgetProblems(rows) {
  return rows
    .filter((row) => !row.ok)
    .map((row) => `The ${row.role} chunk is ${formatKiB(row.gzipBytes)} gzipped, over its ${formatKiB(row.limitBytes)} budget (${row.files.join(', ')}).`);
}

/**
 * Every file that contains a dev-hook name, with the names it contains in DEV_HOOK_WORDS order.
 *
 * @param {readonly { path: string, text: string }[]} files
 */
export function devHookMatches(files) {
  return files
    .map((file) => ({ path: file.path, words: DEV_HOOK_WORDS.filter((word) => file.text.includes(word)) }))
    .filter((match) => match.words.length > 0);
}

/** The first `import(` of a lazy chunk left in inlined code ("import(`./RobotScreen-abc.js`)"), or null. */
export function lazyImportLeft(code) {
  const match = /\bimport\(\s*([`'"])(?:\.{1,2}\/|\/?assets\/)[^`'"]*\.js\1\s*\)/.exec(code);
  return match === null ? null : match[0];
}
