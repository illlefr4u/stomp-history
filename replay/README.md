# Stomp History Replay Harness

Goal: drive the transpiled `stompgg/chomp` Engine with on-chain commit/reveal pairs and emit a per-turn timeline so the viewer shows **full combat** (HP, statuses, KOs, applied effects) instead of just the move stream.

## Status — working v1

| | |
|---|---|
| **Transpile path** | Working. Pinned to chomp `a3a701de8a059d6284c3dc71bb0a521bf1a41b93`. `npm run build:engine` clones + transpiles in ~3s. |
| **Harness** | `src/harness.ts` wraps the transpiled `Engine` (modeled on `snack/munch`'s `battle-harness.ts`): provides minimal `ITeamRegistry` / `IMatchmaker` stubs, registers on-chain contract addresses with the container, and uses the inline-stamina-regen sentinel as the ruleset to skip `DefaultRuleset.getInitialGlobalEffects`. |
| **Catalog** | `src/data/addresses.ts` and `src/data/mons.ts` carry the 13-mon stat catalog + mainnet addresses pulled from `snack/munch`. |
| **CLI** | `src/runReplay.ts` reads JSON inputs from stdin, executes the on-chain reveal stream turn-by-turn, and prints `{ ok, frames[] }` to stdout (`bigint` serialised as strings). |
| **Integration** | `server.py` exposes `GET /api/replay?address=…&battle=…`; the web viewer renders the timeline per frame (HP bars, stamina, status chips, active highlight). |

## Quick start

```bash
cd replay
npm install
npm run build:engine    # clones chomp, transpiles, writes engine/ (gitignored, ~3s)
npm run typecheck       # 0 errors expected
```

Then `python3 server.py` from the repo root exposes `/api/replay`. The web UI
calls it on demand when you click "Run replay" on a selected battle.

## Why the transpile path works

Owen (stompgg) pointed at the transpiler. Pre-quests src + main's transpiler emit clean TypeScript: 103 files, 0 type errors. Earlier attempt with pre-quests transpiler against pre-quests src produced 195 errors because that version mangled inline assembly in Solady libs (`ECDSA`, `EnumerableSetLib`, `Ownable`, `CreateX`) and broke `factories.ts`. The main-branch transpiler resolves those.

One missing artefact (`rng/IGachaRNG.ts`) is patched in via the build script — main transpiler skips it because gacha is not exported, but `factories.ts` still references the interface. We copy the pre-quests-transpiler version of that single file back in.

## License note

`replay/engine/` is gitignored on purpose. The transpiler (extruder) is AGPL-3.0; its emitted runtime base classes likely carry the same license obligation. Keeping `engine/` ephemeral (build-time fetch) lets `stomp-history` itself stay MIT for the viewer parts. Anyone running the replay locally clones + transpiles the engine themselves under AGPL terms. If we later need to vendor `engine/` (e.g. for hosted deploy), the `replay/` subtree must be licensed AGPL-3.0.

## Known gaps

- No `IRuleset` wiring beyond the inline stamina-regen sentinel — global
  effects from `DefaultRuleset.getInitialGlobalEffects` are skipped. Effects
  that come from moves/abilities (Overclock, Chain Expansion, statuses) DO
  apply correctly because the engine adds them via `addEffect` during normal
  turn execution.
- Salt encoding: on-chain salts are uint104 packed; we pad them to bytes32
  before handing to `DefaultRandomnessOracle.getRNG(bytes32, bytes32)`. Should
  match the chain's encoding because the chain itself stores salts in the same
  packed form before hashing.
- No regression tests yet. Adding a tiny fixture suite (input JSON → expected
  final HP/KO list) is the obvious next step.

## Reference

- `stompgg/chomp` repo: <https://github.com/stompgg/chomp>
- Pinned commit (last pre-quests, matches mainnet engine): `a3a701de8a059d6284c3dc71bb0a521bf1a41b93`
- Engine constructor takes `(_DEFAULT_MONS_PER_TEAM, _DEFAULT_MOVES_PER_MON, _DEFAULT_TIMEOUT_DURATION)` — pre-quests default values are visible in the source.
- `Structs.Battle` and `Structs.createDefaultBattle()` document the full dependency set Engine expects.
