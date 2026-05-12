# Stomp History Replay Harness

Goal: drive the transpiled `stompgg/chomp` Engine with on-chain commit/reveal pairs and emit a per-turn timeline so the viewer shows **full combat** (HP, statuses, KOs, applied effects) instead of just the move stream.

## Status — scaffold

| | |
|---|---|
| **Transpile path** | Working. Pinned to chomp `a3a701de8a059d6284c3dc71bb0a521bf1a41b93` (last pre-quests commit). Use `main`'s transpiler version on that src — emits 103 files with 0 type errors after typecheck. |
| **Engine API surface** | Identified. Key entry points: `Engine.startBattle(Battle)`, `Engine.executeWithMoves(battleKey, p0Move, p0Salt, p0Extra, p1Move, p1Salt, p1Extra)`, `Engine.executeWithSingleMove(...)` for force-switch turns, `Engine.getBattle(battleKey)` + `getMonValueForBattle(...)` for state reads. |
| **Scaffolded** | `replay/scripts/fetch-and-transpile-engine.sh`, `replay/src/runReplay.ts` (skeleton with input/output types), `replay/tests/` (empty), gitignore for `engine/` output. |
| **Open** | Concrete `IRuleset` / `IValidator` / `IRandomnessOracle` / `ITeamRegistry` wiring + state-capture loop + Node CLI shim consumed by `server.py`. |

## Quick start

```bash
cd /Users/al/Documents/code/stomp-history/replay
npm install
npm run build:engine    # clones chomp, transpiles, writes engine/ (gitignored, ~3s)
npm run typecheck       # 0 errors expected
```

## Why the transpile path works

Owen (stompgg) pointed at the transpiler. Pre-quests src + main's transpiler emit clean TypeScript: 103 files, 0 type errors. Earlier attempt with pre-quests transpiler against pre-quests src produced 195 errors because that version mangled inline assembly in Solady libs (`ECDSA`, `EnumerableSetLib`, `Ownable`, `CreateX`) and broke `factories.ts`. The main-branch transpiler resolves those.

One missing artefact (`rng/IGachaRNG.ts`) is patched in via the build script — main transpiler skips it because gacha is not exported, but `factories.ts` still references the interface. We copy the pre-quests-transpiler version of that single file back in.

## License note

`replay/engine/` is gitignored on purpose. The transpiler (extruder) is AGPL-3.0; its emitted runtime base classes likely carry the same license obligation. Keeping `engine/` ephemeral (build-time fetch) lets `stomp-history` itself stay MIT for the viewer parts. Anyone running the replay locally clones + transpiles the engine themselves under AGPL terms. If we later need to vendor `engine/` (e.g. for hosted deploy), the `replay/` subtree must be licensed AGPL-3.0.

## Next steps

1. **Wire concrete dependencies** in `runReplay.ts`:
   - `DefaultRuleset` with the effect list pulled from on-chain `_effects` (or hardcoded list matching mainnet ruleset: `StaminaRegen`, `StatBoosts`, `BurnStatus`, `PanicStatus`, `SleepStatus`, `ZapStatus`, `FrostbiteStatus`, `Overclock`, ...).
   - `DefaultValidator`.
   - `RecordedSaltOracle` implementing `IRandomnessOracle` — returns the recorded salts in order so the engine produces the same crits / accuracy outcomes as on-chain.
   - `StaticTeamRegistry` returning the 4-mon teams for each `(player, teamIndex)`.
2. **State-capture loop**: after every `executeWithMoves`, call `engine.getBattle(key)` + `getMonValueForBattle` per mon per stat and serialize to `TimelineFrame`.
3. **Node CLI shim**: stdin JSON `ReplayInputs` → stdout JSON `TimelineFrame[]`. Called by `server.py` via subprocess on the `/battle/<hash>/replay` route.
4. **Tests**: pick 3–5 known battles from `~/Documents/code/stomp_gg/battle_logs/` with confirmed final state, assert replay produces matching final HP / KO list.
5. **Web UI**: render frames in the existing terminal-styled viewer. Text per frame is fine for v1.
6. **README pruning**: drop the "Current limitation" section in the parent `stomp-history/README.md` once the endpoint works.

## Reference

- `stompgg/chomp` repo: <https://github.com/stompgg/chomp>
- Pinned commit (last pre-quests, matches mainnet engine): `a3a701de8a059d6284c3dc71bb0a521bf1a41b93`
- Engine constructor takes `(_DEFAULT_MONS_PER_TEAM, _DEFAULT_MOVES_PER_MON, _DEFAULT_TIMEOUT_DURATION)` — pre-quests default values are visible in the source.
- `Structs.Battle` and `Structs.createDefaultBattle()` document the full dependency set Engine expects.
