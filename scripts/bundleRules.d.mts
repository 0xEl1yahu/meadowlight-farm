/** Types for scripts/bundleRules.mjs, so tests/checkBundle.test.ts typechecks without allowJs. */

export interface BuiltChunk {
  readonly file: string;
  readonly gzipBytes: number;
  readonly sources: readonly string[];
  /** True when the chunk has no source map (its `sources` is then empty). */
  readonly unmapped?: boolean;
}

export interface ChunkRoles {
  readonly main: BuiltChunk | null;
  readonly screen: BuiltChunk | null;
  readonly editor: readonly BuiltChunk[];
  readonly other: readonly BuiltChunk[];
  readonly problems: readonly string[];
}

export interface BudgetRow {
  readonly role: 'main' | 'screen' | 'editor';
  readonly files: readonly string[];
  readonly gzipBytes: number;
  readonly limitBytes: number;
  readonly ok: boolean;
}

export declare const KIB: number;
export declare const EDITOR_MAX_GZIP: number;
export declare const SCREEN_MAX_GZIP: number;
export declare const MAIN_GROWTH_MAX_GZIP: number;
export declare const UNMAPPED_MAX_GZIP: number;
export declare const BLOCKLY_SOURCE: string;
export declare const SCREEN_SOURCE: string;
export declare const DEV_HOOK_WORDS: readonly string[];

export declare function formatKiB(bytes: number): string;
export declare function entryScriptPath(html: string): string | null;
export declare function classifyChunks(chunks: readonly BuiltChunk[], entryFile: string | null): ChunkRoles;
export declare function evaluateBudgets(
  roles: Pick<ChunkRoles, 'main' | 'screen' | 'editor'>,
  baselineMainGzip: number,
): readonly BudgetRow[];
export declare function budgetProblems(rows: readonly BudgetRow[]): readonly string[];
export declare function devHookMatches(
  files: readonly { readonly path: string; readonly text: string }[],
): readonly { readonly path: string; readonly words: readonly string[] }[];
export declare function lazyImportLeft(code: string): string | null;
