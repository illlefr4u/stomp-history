# Codex Handoff — Full Combat Replay via Transpiled Engine

**Owner:** Claude (overall project owner — Codex executes specific tasks under direction).
**Goal:** Resolve the stomp-history "current limitation" — show full combat replay (HP/status/effects timeline) instead of just the on-chain move stream.

## Background

Owen (No Free Tokens) confirmed the path on 2026-05-12: clone `stompgg/chomp`, run the `extruder` transpiler, feed `(moves, salts, etc.)` into the generated TS engine, get deterministic battle outcome. README current limitation note becomes false once this is wired in.

Important: use the **pre-quests commit** `a3a701de8a059d6284c3dc71bb0a521bf1a41b93` on `stompgg/chomp`. `main` is currently ahead of mainnet engine logic — pre-quests last commit matches what the deployed Engine on MegaETH actually executes.

## What I already did (state on disk)

Local at `~/tmp/chomp-pre-quests/`:

- Cloned `stompgg/chomp` and checked out `a3a701de8a059d6284c3dc71bb0a521bf1a41b93`.
- Ran `python3 -m transpiler src/ -o ts-output -d src --emit-metadata`. Took 3.2s, no Python dependency install needed (stdlib only).
- Produced 126 TS files under `~/tmp/chomp-pre-quests/ts-output/`:
  - `Engine.ts`, `Constants.ts`, `DefaultRuleset.ts`, `DefaultValidator.ts`, `IEngine.ts`, `Structs.ts`, `Enums.ts`, `factories.ts`.
  - Sub-dirs: `mons/`, `moves/`, `abilities/`, `effects/`, `effects/status/`, `effects/battlefield/`, `rng/`, `types/`, `lib/`, `commit-manager/`, `matchmaker/`, `hooks/`, `cpu/`.
- Transpiler emitted `unresolved-dependencies.json` listing interface → impl bindings the codegen could not auto-resolve. These must be filled in via `dependency-overrides.json` or wired in the harness.

Sample unresolved cases (full list in `~/tmp/chomp-pre-quests/ts-output/unresolved-dependencies.json`):

- `BetterCPU.rng: ICPURNG`
- `DefaultRuleset._effects: IEffect`
- `GachaRegistry._MON_REGISTRY: IMonRegistry`, `_RNG: IGachaRNG`
- `GachaTeamRegistry._OWNER_LOOKUP: IOwnableMon`

For pure battle replay we likely care about: `DefaultRuleset._effects` (must contain the registered status/battlefield effect classes), `DefaultValidator` deps, and an `IRandomnessOracle` impl. The on-chain RNG comes from commit-reveal salts, so the oracle adapter is the part that needs custom wiring to feed extracted salts back.

Also one warning during transpile: `transpiler-config.json` failed to parse (`line 55 column 3`). Did not block output. Worth fixing if you start tweaking transpile config, otherwise ignore.

## What I want back from you

Build a **standalone Node replay harness** that resolves the stomp-history limitation. Concrete deliverables:

1. **`replay/` directory inside this repo** (`/Users/al/Documents/code/stomp-history/replay/`) containing:
   - `package.json` with deps (`viem` if needed for ABI decoding, `typescript`, `vitest` for tests).
   - The transpiled TS engine vendored or referenced (decide: copy from `~/tmp/chomp-pre-quests/ts-output/` into `replay/engine/`, OR add it as a git submodule pointing at the pre-quests commit, OR keep upstream as a fetch step in a Makefile). Pick whichever has the cleanest license story (note transpiler is AGPL-3.0 — adjust LICENSE if needed; current stomp-history is MIT). Discuss this trade-off in `replay/README.md`.
   - `replay/src/runBattle.ts` — entry point. Signature roughly:
     ```ts
     export interface BattleInputs {
       teamA: TeamSpec;
       teamB: TeamSpec;
       ruleset: RulesetSpec;
       turns: Array<{ commitsA: TurnCommit; commitsB: TurnCommit; revealedA: Reveal; revealedB: Reveal; salt: bigint; }>;
     }
     export interface TimelineFrame { turnIndex: number; activeA: SlotState; activeB: SlotState; effects: EffectFrame[]; appliedEvents: AppliedEvent[]; }
     export function runBattle(inputs: BattleInputs): TimelineFrame[];
     ```
     Take inputs sourced from on-chain events (the move/commit/reveal streams we already extract in `stomp_history.py`), and emit a per-turn timeline that captures HP, stamina, status, atk_stacks, snack levels, Q5 timers, overclock, zap skip, etc. — everything currently missing from the viewer.
   - `replay/tests/` — at minimum: replay 3–5 known historical battles (use hashes already saved in `analysis/battle_logs/` of the `stomp_gg` repo for reference) and assert final HP / KO list matches the on-chain final state.

2. **Adapter integration into `server.py` and `web/`:**
   - Server endpoint that calls the replay (e.g. `GET /battle/<hash>/replay` → JSON timeline). Keep cache-friendly (timeline is deterministic given on-chain inputs, can be cached per battle hash).
   - Web UI update: instead of only listing selected moves, render the timeline frame-by-frame. Keep the existing terminal-first feel — text per frame is fine for v1, no need for animation. Bonus: show diff highlights (HP drop, status applied, KO).

3. **README + Twitter follow-up text:**
   - Update `README.md` to drop the "Current limitation" section once feature parity reached.
   - Draft a short follow-up tweet (≤280 chars) announcing full replay support. Match my voice (see existing pinned tweet at `https://github.com/illlefr4u/stomp-history` for tone — friendly, no marketing jargon, no em dashes).

## Constraints

- **Do not modify the transpiled TS files in `~/tmp/chomp-pre-quests/ts-output/`.** If something needs patching, file it as a `replay/patches/<filename>.diff` so we can re-apply after re-transpile.
- **Do not run live mainnet transactions, do not sign anything, do not touch wallet surfaces.** The viewer is read-only and must stay that way.
- **Do not refactor existing `server.py` or `stomp_history.py` beyond what is needed for the new endpoint.** If you spot bugs or improvements unrelated to replay, list them in `replay/FOLLOWUPS.md` instead of changing them.
- **License:** if the transpiled engine is vendored, the consumer (stomp-history `replay/`) becomes AGPL-3.0. Either accept that and bump `replay/LICENSE`, or fetch the engine at build time as an external dependency (preferred — keeps stomp-history MIT for the viewer parts, AGPL only inside `replay/`). Document the choice in `replay/README.md`.
- **No Codex retries on opaque failures.** If transpiler output throws at runtime in a way that needs upstream patches, stop and surface the case — do not silently rewrite generated code.

## Open questions for you to confirm before deep work

1. Vendor vs. external-fetch for transpiled engine? (Recommend external-fetch: a `scripts/fetch-engine.sh` that clones `stompgg/chomp` at the pinned commit and runs `python3 -m transpiler ...`. Then `replay/engine/` is gitignored.)
2. Salt source: on-chain we have `commitments` and `reveals` per turn. Need to confirm the exact event names and field shapes from MegaETH explorer. Use `stomp_history.py` as reference for what's already extracted.
3. Test fixture battles: pick 3–5 from `~/Documents/code/stomp_gg/battle_logs/` that have known outcomes — use them as snapshot assertions.

## Return artifacts

When done:

- PR-ready diff of the `replay/` directory + integration patches to `server.py` and `web/`.
- A short status report at the top of this file (replace this section with "Status: complete" and a summary of what shipped).
- Updated `README.md` and the follow-up tweet draft.

If you hit a blocker that needs Claude's input — leave a `### BLOCKED` note here and stop work; don't guess.

---

## State as of handoff (timestamp 2026-05-12)

- Transpile output ready at `~/tmp/chomp-pre-quests/ts-output/`.
- No code changes yet in this repo.
- depth=9 analysis run unrelated, on `backtest1` — Claude handles that side.
