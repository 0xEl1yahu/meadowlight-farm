/**
 * The bundle rules behind scripts/check-bundle.mjs and scripts/build-single.mjs (farmclaws part 3
 * spec §10, part 4b spec §10), on made-up chunks: finding the entry, sorting chunks by their source
 * maps, the four budgets, Blockly's placement, the dev-hook grep and the single-file guard.
 */
import { describe, expect, it } from 'vitest';
import {
  DEV_HOOK_WORDS,
  EDITOR_MAX_GZIP,
  KIB,
  MAIN_GROWTH_MAX_GZIP,
  UNMAPPED_MAX_GZIP,
  SCREEN_MAX_GZIP,
  SHOPS_MAX_GZIP,
  budgetProblems,
  classifyChunks,
  devHookMatches,
  entryScriptPath,
  evaluateBudgets,
  formatKiB,
  lazyImportLeft,
  type BuiltChunk,
} from '../scripts/bundleRules.mjs';

const MAIN: BuiltChunk = { file: 'assets/index-AAA.js', gzipBytes: 270 * KIB, sources: ['../../src/main.ts', '../../node_modules/three/build/three.core.js'] };
const SCREEN: BuiltChunk = {
  file: 'assets/RobotScreen-BBB.js',
  gzipBytes: 30 * KIB,
  sources: ['../../src/ui/robotScreen/RobotScreen.ts', '../../src/ui/robotScreen/translate.ts'],
};
const SHOPS: BuiltChunk = {
  file: 'assets/ShopsScreen-GGG.js',
  gzipBytes: 8 * KIB,
  sources: ['../../src/ui/shops/ShopsScreen.ts', '../../src/ui/shops/PartsShopPanel.ts'],
};
const CORE: BuiltChunk = { file: 'assets/blockly-CCC.js', gzipBytes: 200 * KIB, sources: ['../../node_modules/blockly/blockly.mjs', '../../node_modules/blockly/blockly_compressed.js'] };
const EN: BuiltChunk = { file: 'assets/en-DDD.js', gzipBytes: 9 * KIB, sources: ['../../node_modules/blockly/msg/en.mjs'] };
const ICONS: BuiltChunk = { file: 'assets/icons-EEE.js', gzipBytes: 2 * KIB, sources: ['../../src/ui/icons.ts'] };
const BASELINE = 275_539;

describe('entryScriptPath', () => {
  it("reads the module script Vite writes into dist/index.html", () => {
    const html = '<head>\n    <script type="module" crossorigin src="/assets/index-CUmkGRNG.js"></script>\n    <link rel="stylesheet" crossorigin href="/assets/index-D-5RKi6P.css">\n</head>';
    expect(entryScriptPath(html)).toBe('assets/index-CUmkGRNG.js');
  });

  it('is null without a module script', () => {
    expect(entryScriptPath('<head><script src="/x.js"></script></head>')).toBeNull();
  });
});

describe('classifyChunks', () => {
  it('finds main by the entry, the screen by RobotScreen.ts, the shops by ShopsScreen.ts and every Blockly chunk as the editor', () => {
    const roles = classifyChunks([CORE, EN, ICONS, MAIN, SCREEN, SHOPS], MAIN.file);
    expect(roles.main).toBe(MAIN);
    expect(roles.screen).toBe(SCREEN);
    expect(roles.shops).toBe(SHOPS);
    expect(roles.editor).toEqual([CORE, EN]);
    expect(roles.other).toEqual([ICONS]);
    expect(roles.problems).toEqual([]);
  });

  it('reads Windows-style source paths too', () => {
    const screen = { ...SCREEN, sources: ['..\\..\\src\\ui\\robotScreen\\RobotScreen.ts'] };
    const core = { ...CORE, sources: ['..\\..\\node_modules\\blockly\\blockly.mjs'] };
    const shops = { ...SHOPS, sources: ['..\\..\\src\\ui\\shops\\ShopsScreen.ts'] };
    const roles = classifyChunks([MAIN, screen, shops, core], MAIN.file);
    expect(roles.screen).toBe(screen);
    expect(roles.shops).toBe(shops);
    expect(roles.editor).toEqual([core]);
    expect(roles.problems).toEqual([]);
  });

  it('refuses Blockly in the main chunk', () => {
    const main = { ...MAIN, sources: [...MAIN.sources, '../../node_modules/blockly/blockly.mjs'] };
    const roles = classifyChunks([main, SCREEN, SHOPS], MAIN.file);
    expect(roles.editor).toEqual([]);
    expect(roles.problems).toEqual([
      'Blockly is in the main chunk (assets/index-AAA.js), e.g. ../../node_modules/blockly/blockly.mjs. Import blockly only through import() inside src/ui/robotScreen/.',
    ]);
  });

  it('refuses Blockly in the screen chunk', () => {
    const screen = { ...SCREEN, sources: [...SCREEN.sources, '../../node_modules/blockly/blockly.mjs'] };
    expect(classifyChunks([MAIN, screen, SHOPS], MAIN.file).problems).toEqual([
      'Blockly is in the screen chunk (assets/RobotScreen-BBB.js), e.g. ../../node_modules/blockly/blockly.mjs. Import blockly only through import() inside src/ui/robotScreen/.',
    ]);
  });

  it('refuses a robot screen bundled into the main chunk', () => {
    const main = { ...MAIN, sources: [...MAIN.sources, '../../src/ui/robotScreen/RobotScreen.ts'] };
    const roles = classifyChunks([main, SHOPS, CORE], MAIN.file);
    expect(roles.screen).toBeNull();
    expect(roles.problems).toEqual(['The robot screen is in the main chunk (assets/index-AAA.js). Load src/ui/robotScreen/RobotScreen.ts only through import().']);
  });

  it('refuses Blockly in the shops chunk', () => {
    const shops = { ...SHOPS, sources: [...SHOPS.sources, '../../node_modules/blockly/blockly.mjs'] };
    expect(classifyChunks([MAIN, SCREEN, shops], MAIN.file).problems).toEqual([
      'Blockly is in the shops chunk (assets/ShopsScreen-GGG.js), e.g. ../../node_modules/blockly/blockly.mjs. Import blockly only through import() inside src/ui/robotScreen/.',
    ]);
  });

  it('refuses the shops bundled into the main chunk', () => {
    const main = { ...MAIN, sources: [...MAIN.sources, '../../src/ui/shops/ShopsScreen.ts'] };
    const roles = classifyChunks([main, SCREEN, CORE], MAIN.file);
    expect(roles.shops).toBeNull();
    expect(roles.problems).toEqual(['The shops are in the main chunk (assets/index-AAA.js). Load src/ui/shops/ShopsScreen.ts only through import().']);
  });

  it('asks for the lazy chunks when they are missing', () => {
    expect(classifyChunks([MAIN], MAIN.file).problems).toEqual([
      "No chunk's source map lists src/ui/robotScreen/RobotScreen.ts. The robot screen must be a lazy chunk of its own.",
      "No chunk's source map lists src/ui/shops/ShopsScreen.ts. The shops must be a lazy chunk of their own.",
      "No lazy chunk's source map lists node_modules/blockly/. The Program tab must load blockly through import().",
    ]);
  });

  it('counts a map-less chunk of at most 1 KiB as other, and refuses a bigger one', () => {
    const helper: BuiltChunk = { file: 'assets/rolldown-runtime-X.js', gzipBytes: UNMAPPED_MAX_GZIP, sources: [], unmapped: true };
    const ok = classifyChunks([MAIN, SCREEN, SHOPS, CORE, helper], MAIN.file);
    expect(ok.other).toEqual([helper]);
    expect(ok.problems).toEqual([]);
    const big = { ...helper, gzipBytes: UNMAPPED_MAX_GZIP + 1 };
    expect(classifyChunks([MAIN, SCREEN, SHOPS, CORE, big], MAIN.file).problems).toEqual([
      "assets/rolldown-runtime-X.js has no source map, so its modules can't be checked. Keep build.sourcemap on.",
    ]);
  });

  it('names a missing entry', () => {
    expect(classifyChunks([SCREEN, SHOPS, CORE], null).problems).toEqual(['dist/index.html has no <script type="module" src="…"> entry.']);
    expect(classifyChunks([SCREEN, SHOPS, CORE], 'assets/index-ZZZ.js').problems).toEqual(["The entry script assets/index-ZZZ.js isn't in dist/assets."]);
  });
});

describe('evaluateBudgets', () => {
  it('sets the limits from spec §10.1 (and part 4b spec §10) and adds up the editor chunks', () => {
    const rows = evaluateBudgets(classifyChunks([MAIN, SCREEN, SHOPS, CORE, EN], MAIN.file), BASELINE);
    expect(EDITOR_MAX_GZIP).toBe(250 * 1024);
    expect(SCREEN_MAX_GZIP).toBe(40 * 1024);
    expect(SHOPS_MAX_GZIP).toBe(20 * 1024);
    expect(MAIN_GROWTH_MAX_GZIP).toBe(26 * 1024);
    expect(rows).toEqual([
      { role: 'main', files: [MAIN.file], gzipBytes: 270 * KIB, limitBytes: BASELINE + 26 * KIB, ok: true },
      { role: 'screen', files: [SCREEN.file], gzipBytes: 30 * KIB, limitBytes: 40 * KIB, ok: true },
      { role: 'shops', files: [SHOPS.file], gzipBytes: 8 * KIB, limitBytes: 20 * KIB, ok: true },
      { role: 'editor', files: [CORE.file, EN.file], gzipBytes: 209 * KIB, limitBytes: 250 * KIB, ok: true },
    ]);
    expect(budgetProblems(rows)).toEqual([]);
  });

  it('allows exactly the limit and refuses one byte more', () => {
    const atLimit = { ...SCREEN, gzipBytes: SCREEN_MAX_GZIP };
    const over = { ...SCREEN, gzipBytes: SCREEN_MAX_GZIP + 1 };
    expect(evaluateBudgets({ main: null, screen: atLimit, shops: null, editor: [] }, BASELINE)[0]?.ok).toBe(true);
    const rows = evaluateBudgets({ main: null, screen: over, shops: null, editor: [] }, BASELINE);
    expect(rows[0]?.ok).toBe(false);
    expect(budgetProblems(rows)).toEqual(['The screen chunk is 40.0 KiB gzipped, over its 40.0 KiB budget (assets/RobotScreen-BBB.js).']);
  });

  it('holds the main chunk to the baseline plus 26 KiB', () => {
    const grown = { ...MAIN, gzipBytes: BASELINE + MAIN_GROWTH_MAX_GZIP + 1 };
    expect(budgetProblems(evaluateBudgets({ main: grown, screen: null, shops: null, editor: [] }, BASELINE))).toEqual([
      `The main chunk is ${formatKiB(BASELINE + MAIN_GROWTH_MAX_GZIP + 1)} gzipped, over its ${formatKiB(BASELINE + MAIN_GROWTH_MAX_GZIP)} budget (assets/index-AAA.js).`,
    ]);
  });

  it('holds the shops chunk to 20 KiB', () => {
    expect(evaluateBudgets({ main: null, screen: null, shops: { ...SHOPS, gzipBytes: SHOPS_MAX_GZIP }, editor: [] }, BASELINE)[0]?.ok).toBe(true);
    const rows = evaluateBudgets({ main: null, screen: null, shops: { ...SHOPS, gzipBytes: SHOPS_MAX_GZIP + 1 }, editor: [] }, BASELINE);
    expect(budgetProblems(rows)).toEqual(['The shops chunk is 20.0 KiB gzipped, over its 20.0 KiB budget (assets/ShopsScreen-GGG.js).']);
  });

  it('holds the editor chunks together to 250 KiB', () => {
    const big = { ...CORE, gzipBytes: 245 * KIB };
    const rows = evaluateBudgets({ main: null, screen: null, shops: null, editor: [big, EN] }, BASELINE);
    expect(rows).toEqual([{ role: 'editor', files: [CORE.file, EN.file], gzipBytes: 254 * KIB, limitBytes: 250 * KIB, ok: false }]);
  });
});

describe('devHookMatches', () => {
  it('names each file and the hook words it contains', () => {
    const files = [
      { path: 'index.html', text: '<div id="app"></div>' },
      { path: 'assets/index-AAA.js', text: 'this.setProgram=function(){}' },
      { path: 'assets/index-AAA.js.map', text: '{"sourcesContent":["// setMd and setZone are dev only"]}' },
      { path: 'assets/dev-FFF.js', text: 'installRobotDev(addScriptedRobot,robotLog,unlockAll)' },
    ];
    expect(devHookMatches(files)).toEqual([
      { path: 'assets/index-AAA.js.map', words: ['setMd', 'setZone'] },
      { path: 'assets/dev-FFF.js', words: ['robotLog', 'installRobotDev', 'addScriptedRobot', 'unlockAll'] },
    ]);
  });

  it('leaves setProgram out of the pattern, for three.js', () => {
    expect(DEV_HOOK_WORDS).toEqual(['robotLog', 'installRobotDev', 'addScriptedRobot', 'setMd', 'setZone', 'unlockAll']);
  });
});

describe('lazyImportLeft', () => {
  it('finds a dynamic import of a built chunk', () => {
    expect(lazyImportLeft('let e=await import(`./RobotScreen-BBB.js`);')).toBe('import(`./RobotScreen-BBB.js`)');
    expect(lazyImportLeft('import("/assets/blockly-CCC.js")')).toBe('import("/assets/blockly-CCC.js")');
    expect(lazyImportLeft("import('assets/en-DDD.js')")).toBe("import('assets/en-DDD.js')");
  });

  it('passes inlined code', () => {
    expect(lazyImportLeft('const t=Promise.resolve().then(()=>(init_RobotScreen(),RobotScreen_exports));')).toBeNull();
  });
});
