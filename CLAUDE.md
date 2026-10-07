# Meadowlight Farm

A 3D low-poly farming sim in the browser (TypeScript, Three.js, Vite, Vitest). Farmclaws adds programmable robots: the design is `docs/superpowers/specs/2026-09-29-farmclaws-design.md`, and each build part has its own spec and plan under `docs/superpowers/`.

## Commands

- `npm run dev`: dev server on localhost:5173 (dev hooks on `window.__meadowlight`).
- `npm run typecheck`, `npm test`, `npm run build`: the gate; all three pass before every commit.
- `npm run build:check`: build plus bundle budgets and the dev-hook grep. Run it for anything that touches imports, the robot screen or Blockly.
- `npm run build:single`: the one-page build in `dist-single/`. It overwrites `dist/`, so run `build:check` after it, not a bare `node scripts/check-bundle.mjs`.
- One test file: `npx vitest run tests/<name>.test.ts`.

## Code rules

- The simulation is pure and deterministic. No `Math.random`, clock reads or I/O in `src/core`, `src/state`, `src/world`, `src/farming`, `src/time` or `src/robots`. Randomness goes through `hash32` / `hashFloat`.
- TypeScript is strict with `erasableSyntaxOnly`: no enums, no namespaces, no parameter properties. Use `as const` objects with union types, and `import type` for types.
- State is immutable with structural sharing: an unchanged robot, chunk or tile keeps its reference. `withRobot` returns the same state when nothing changed.
- Numbers come from `src/config.ts`, never inline.
- No TODOs, placeholders or stubs.
- Write text with `textContent`, never `innerHTML` with game data.
- Follow the surrounding code: its comment density, naming and doc-comment style.

## Rules we learned the hard way

- **Saves:** a new saved field goes into its type, `createInitialState`, the migration and validation in the same commit. Bump `SAVE_VERSION`, write `migrateVNtoVN+1`, and extend `v5Save`-style helpers in `tests/testUtils.ts` so older-save tests keep working.
- **Dev hooks stay out of production.** No production file (comments and strings included) may contain `setMd`, `setZone`, `unlockAll`, `robotLog`, `installRobotDev` or `addScriptedRobot`. Source maps carry the source text, and `build:check` greps for them. Name actions like `robot/md`, not `robot/setMd`.
- **Lazy chunks:** `src/ui/robotScreen/` loads through one dynamic import, and Blockly through another inside it. Never import them statically from the main chunk.
- **Gate checks:** the gate is typecheck, tests and build. "The tests pass" alone isn't done.
- **Robot speech** (`robotSays`) always ends in " ✓", even for failures. Only `whatHappened` and toasts tell the truth.
- **Validation:** `isProgramShape` → `checkProgram` and `isMdShape` → `checkMd` are the only gate for programs and .MDs.
- **Bumps** are decided once per minute from start-of-minute positions, never in id order. Don't re-check robots in `planRobotAction`.
- **Spec sync:** when a build changes a spec rule or number, update the spec in the same branch and record it as a plan refinement.

## Working with Eli

- **Eli is the creative director.** Ask him questions, and trust his judgement on design, scope and feel. When something is his call, ask with a recommendation; don't decide for him.
- **Nothing is executed on his behalf without explicit sign-off.** That covers starting a build, committing, merging, pushing, deleting, and changing settings or accounts. A sign-off covers only what was presented, and earlier approvals don't carry over.

## Workflow

- New features go spec → reviewed plan → build, using the superpowers skills (brainstorming, writing-plans, subagent-driven-development). Specs say what's final; plans quote the code they change.
- Browser checks use the `game-driven-qa` skill (`.claude/skills/game-driven-qa/`), with playbooks per part in `scenarios/`.
- **Every feature build gets its own new branch** off `main`, named for the feature (e.g. `p4a-people`). Never work straight on `main`.
- Pushing to `origin` (github.com/0xEl1yahu/meadowlight-farm) needs the GitHub CLI's `0xEl1yahu` account active. Switch back afterwards.
- Commit messages: a short, plain summary, then why. Part commits start with `Farmclaws part N: `.

When Claude gets something wrong in this repo, add a line here so it doesn't happen twice.
