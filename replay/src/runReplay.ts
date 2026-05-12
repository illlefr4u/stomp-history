// Replay harness for stomp-history viewer.
// Drives the transpiled chomp Engine with on-chain commit/reveal pairs and
// emits a per-turn timeline (HP, statuses, KOs, applied effects) so the
// viewer can show full combat instead of just the on-chain move stream.
//
// Status: SCAFFOLD. Engine import path verified after `npm run build:engine`.
// Pieces still to wire up:
//   - Concrete IRuleset (DefaultRuleset) with effect list.
//   - Concrete IValidator (DefaultValidator).
//   - IRandomnessOracle that returns the recorded on-chain salts in order.
//   - Team registry stub that resolves (player, teamIndex) → 4 mons.
//   - State-capture loop after each executeWithMoves call.
//
// Once wired, `runReplay()` will be called from the Python server via a Node
// subprocess: input JSON on stdin (battle hash + on-chain reveal stream),
// output JSON timeline on stdout. Keep deterministic — same inputs → same
// frames byte-for-byte.

import { Engine } from "../engine/Engine.js";
import * as Structs from "../engine/Structs.js";

export interface ReplayTurn {
  /** Player 0's revealed move index (uint256). */
  p0MoveIndex: bigint;
  /** Player 0's salt (bytes32 hex). */
  p0Salt: string;
  /** Player 0's extra data (uint256), e.g. switch target index. */
  p0ExtraData: bigint;
  p1MoveIndex: bigint;
  p1Salt: string;
  p1ExtraData: bigint;
}

export interface ReplayInputs {
  battleKey: string; // 0x-prefixed bytes32
  p0: string;
  p1: string;
  /** Pre-registered team indices on whichever ITeamRegistry we use. */
  p0TeamIndex: bigint;
  p1TeamIndex: bigint;
  turns: ReplayTurn[];
}

export interface TimelineFrame {
  turnId: number;
  p0Active: number;
  p1Active: number;
  p0Mons: MonSnapshot[];
  p1Mons: MonSnapshot[];
  globalEffects: EffectSnapshot[];
  winnerIndex: number | null;
}

export interface MonSnapshot {
  hp: bigint;
  stamina: bigint;
  effects: EffectSnapshot[];
}

export interface EffectSnapshot {
  name: string;
  extraData: string;
}

export function runReplay(inputs: ReplayInputs): TimelineFrame[] {
  // ---- TODO: bind concrete dependencies ----
  // const validator = new DefaultValidator(...);
  // const ruleset = new DefaultRuleset(engine, [new StaminaRegen(), new StatBoosts(), ...]);
  // const oracle = new RecordedSaltOracle(inputs.turns.map(t => t.p0Salt /* or canonical */));
  // const teamRegistry = new StaticTeamRegistry({ ... });
  // const engineHooks = [];
  // const moveManager = ZERO_ADDRESS;
  // const matchmaker = STUB_MATCHMAKER;

  const engine = new Engine();

  // const battle: Structs.Battle = {
  //   p0: inputs.p0,
  //   p0TeamIndex: inputs.p0TeamIndex,
  //   p1: inputs.p1,
  //   p1TeamIndex: inputs.p1TeamIndex,
  //   teamRegistry,
  //   validator,
  //   rngOracle: oracle,
  //   ruleset,
  //   moveManager,
  //   matchmaker,
  //   engineHooks,
  // };
  // engine.startBattle(battle);

  const timeline: TimelineFrame[] = [];

  for (let i = 0; i < inputs.turns.length; i++) {
    const t = inputs.turns[i];
    // engine.executeWithMoves(
    //   inputs.battleKey,
    //   t.p0MoveIndex, t.p0Salt, t.p0ExtraData,
    //   t.p1MoveIndex, t.p1Salt, t.p1ExtraData,
    // );
    // timeline.push(snapshotState(engine, inputs.battleKey, i));
    void engine;
    void t;
  }

  return timeline;
}

// CLI shim: read JSON from argv[2] (path), emit JSON to stdout.
if (typeof process !== "undefined" && process.argv[1] && process.argv[1].endsWith("runReplay.ts")) {
  console.error("[runReplay] scaffold only — wire dependencies before running.");
  process.exit(2);
}
