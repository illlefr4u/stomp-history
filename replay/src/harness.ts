// Battle replay harness — wraps the transpiled stomp Engine so we can drive it
// with on-chain (moveIndex, salt, extraData) tuples and capture a per-turn
// timeline of HP, stamina, statuses, and effects.
//
// Modeled on snack/munch's sim-tests/harness.ts + ts-output/runtime/battle-harness.ts,
// pared down to what replay needs (no mapper, no priority audit, no extended mons).

import { Engine } from '../engine/Engine';
import { DefaultValidator } from '../engine/DefaultValidator';
import { DefaultRandomnessOracle } from '../engine/rng/DefaultRandomnessOracle';
import { ContractContainer } from '../engine/runtime';
import { Contract, ADDRESS_ZERO, globalEventStream, contractAddresses } from '../engine/runtime/base';
import { setupContainer } from '../engine/factories';
import * as Structs from '../engine/Structs';
import * as Constants from '../engine/Constants';
import { Type } from '../engine/Enums';

import { MAINNET_ADDRESSES, isInlineAddress, snakeToPascal } from './data/addresses';
import { MON_CATALOG, buildMonFromCatalog, DEFAULT_STAMINA } from './data/mons';

// =============================================================================
// Harness sentinel addresses
// =============================================================================

const HARNESS_MOVE_MANAGER = '0x000000000000000000000000000000000000beef';
const HARNESS_MATCHMAKER   = '0x000000000000000000000000000000000000cafe';
const HARNESS_TEAM_REGISTRY = '0x000000000000000000000000000000000000aaaa';

// =============================================================================
// Minimal ITeamRegistry — returns the teams the caller registers
// =============================================================================

class ReplayTeamRegistry {
  _contractAddress: string = HARNESS_TEAM_REGISTRY;
  private teams: Record<string, Record<string, Structs.Mon[]>> = {};
  private nextIdx: Record<string, number> = {};

  registerTeam(player: string, team: Structs.Mon[]): bigint {
    const k = player.toLowerCase();
    this.teams[k] ??= {};
    this.nextIdx[k] ??= 0;
    const idx = this.nextIdx[k];
    this.teams[k][String(idx)] = team;
    this.nextIdx[k] = idx + 1;
    return BigInt(idx);
  }

  getTeam(player: string, teamIndex: bigint): Structs.Mon[] {
    return this.teams[player.toLowerCase()]?.[String(teamIndex)] || [];
  }

  getTeams(p0: string, p0Idx: bigint, p1: string, p1Idx: bigint): [Structs.Mon[], Structs.Mon[]] {
    return [this.getTeam(p0, p0Idx), this.getTeam(p1, p1Idx)];
  }

  getTeamCount(player: string): bigint {
    return BigInt(this.nextIdx[player.toLowerCase()] || 0);
  }

  getMonRegistry(): any { return null; }
  getMonRegistryIndicesForTeam(player: string, teamIndex: bigint): bigint[] {
    return this.getTeam(player, teamIndex).map((_, i) => BigInt(i));
  }
  createTeam(): bigint { return 0n; }
  deleteTeam(): void {}
  updateTeam(): void {}
  getOrderedLiveTeams(player: string): bigint[] {
    return Object.keys(this.teams[player.toLowerCase()] || {}).map(BigInt);
  }
  getPlayerTeams(player: string): [bigint[], bigint[][]] {
    const slots = this.getOrderedLiveTeams(player);
    return [slots, slots.map((s) => this.getMonRegistryIndicesForTeam(player, s))];
  }

  validateMon(): boolean { return true; }
  validateMonBatch(): boolean { return true; }
  isValidMove(): boolean { return true; }
  isValidAbility(): boolean { return true; }
}

// =============================================================================
// Minimal IMatchmaker — accepts any registered battle from either player
// =============================================================================

class ReplayMatchmaker {
  _contractAddress: string = HARNESS_MATCHMAKER;
  private battles: Map<string, { p0: string; p1: string }> = new Map();

  registerBattle(battleKey: string, p0: string, p1: string): void {
    this.battles.set(battleKey, { p0: p0.toLowerCase(), p1: p1.toLowerCase() });
  }

  validateMatch(battleKey: string, player: string): boolean {
    const b = this.battles.get(battleKey);
    if (!b) return false;
    const p = player.toLowerCase();
    return p === b.p0 || p === b.p1;
  }
}

// =============================================================================
// Frame snapshot types — what the CLI emits per turn
// =============================================================================

export interface MonFrame {
  slot: number;
  id: number;            // mon id (0..12) if known; -1 if registered without catalog
  name: string;
  maxHp: number;
  hp: number;
  maxStamina: number;
  stamina: number;
  isKnockedOut: boolean;
  shouldSkipTurn: boolean;
  effects: EffectFrame[];
}

export interface EffectFrame {
  name: string;
  extraData: string;
}

export interface MoveDescription {
  side: 'p0' | 'p1';
  moveIndex: number;
  label: string;          // "Big Bite" / "Switch -> Sofabbi" / "Rest"
  activeMonIndex: number;
  activeMon: string;
  target?: string;
}

export interface TimelineFrame {
  turnId: number;
  activeMonIndex: [number, number];
  p0Mons: MonFrame[];
  p1Mons: MonFrame[];
  globalEffects: EffectFrame[];
  winnerIndex: 0 | 1 | 2;        // 2 = ongoing
  moves: MoveDescription[];      // what each side selected this turn
  events: { name: string; data: any }[];
}

// =============================================================================
// HarnessBundle — Engine + container + helpers
// =============================================================================

export interface HarnessBundle {
  engine: any;
  container: ContractContainer;
  teamRegistry: ReplayTeamRegistry;
  matchmaker: ReplayMatchmaker;
}

export function makeHarness(): HarnessBundle {
  // Fresh global state per harness instance: a previous run may have left
  // stale entries in the address registry.
  Contract.clearRegistry();
  contractAddresses.clear();
  globalEventStream.clear();

  const container = new ContractContainer();
  setupContainer(container);
  // Engine wants a few constructor args. Pre-quests defaults: 4 mons, 4 moves, 30s timeout.
  container.registerLazySingleton('Engine', [], () => new Engine(
    Constants.GAME_MONS_PER_TEAM,
    Constants.GAME_MOVES_PER_MON,
    Constants.GAME_TIMEOUT_DURATION,
  ));
  // DefaultValidator needs (engine, args). Args contains the engine's constants.
  container.registerSingleton('Args', {
    MONS_PER_TEAM: Constants.GAME_MONS_PER_TEAM,
    MOVES_PER_MON: Constants.GAME_MOVES_PER_MON,
    TIMEOUT_DURATION: Constants.GAME_TIMEOUT_DURATION,
  });
  container.registerLazySingleton('DefaultValidator', ['Engine', 'Args'],
    (e: any, a: any) => new DefaultValidator(e, a));

  // Bind on-chain addresses to the resolved contract instances. The Contract
  // setter auto-registers them in Contract._addressRegistry.
  for (const [key, addr] of Object.entries(MAINNET_ADDRESSES)) {
    const pascal = snakeToPascal(key);
    const lower160 = isInlineAddress(addr)
      ? '0x' + (BigInt(addr) & ((1n << 160n) - 1n)).toString(16).padStart(40, '0')
      : addr;
    if (lower160 === ADDRESS_ZERO) continue;
    try {
      const instance = container.tryResolve(pascal);
      if (instance && typeof instance === 'object') {
        (instance as any)._contractAddress = lower160;
      }
    } catch { /* not every address has a registered contract */ }
  }

  const engine = container.resolve('Engine') as any;
  engine._block.timestamp = 1_800_000_000n;
  engine._block.number = 1n;

  return {
    engine,
    container,
    teamRegistry: new ReplayTeamRegistry(),
    matchmaker: new ReplayMatchmaker(),
  };
}

// =============================================================================
// Battle setup
// =============================================================================

export interface BattleSetup {
  p0: string;
  p1: string;
  p0MonIds: number[];   // catalog ids; length should match GAME_MONS_PER_TEAM
  p1MonIds: number[];
}

export function startBattle(bundle: HarnessBundle, setup: BattleSetup): `0x${string}` {
  const { engine, container, teamRegistry, matchmaker } = bundle;

  const p0Team = setup.p0MonIds.map(buildMonFromCatalog);
  const p1Team = setup.p1MonIds.map(buildMonFromCatalog);

  const p0Idx = teamRegistry.registerTeam(setup.p0, p0Team);
  const p1Idx = teamRegistry.registerTeam(setup.p1, p1Team);

  const [battleKey] = engine.computeBattleKey(setup.p0, setup.p1) as [`0x${string}`, `0x${string}`];
  matchmaker.registerBattle(battleKey, setup.p0, setup.p1);

  engine.__mutateIsMatchmakerFor(setup.p0, matchmaker._contractAddress, true);
  engine.__mutateIsMatchmakerFor(setup.p1, matchmaker._contractAddress, true);

  const validator   = container.resolve('IValidator');
  const rngOracle   = container.resolve('IRandomnessOracle');
  // Pass the inline stamina-regen sentinel so the engine takes the fast path
  // and skips DefaultRuleset.getInitialGlobalEffects (which would need an
  // effects array injected via the container).
  const ruleset = { _contractAddress: Constants.INLINE_STAMINA_REGEN_RULESET } as any;

  const battle: Structs.Battle = {
    p0: setup.p0,
    p0TeamIndex: p0Idx,
    p1: setup.p1,
    p1TeamIndex: p1Idx,
    teamRegistry: teamRegistry as any,
    validator: validator as any,
    rngOracle: rngOracle as any,
    ruleset,
    moveManager: HARNESS_MOVE_MANAGER,
    matchmaker: matchmaker as any,
    engineHooks: [],
  };

  Contract._currentCaller = matchmaker._contractAddress;
  engine.startBattle(battle);
  Contract._currentCaller = ADDRESS_ZERO;

  // Initialize MonState slots — Solidity returns default-zero from uninitialized
  // storage, but TypeScript returns undefined which the engine reads as crash.
  const storageKey = engine._getStorageKey(battleKey);
  const config = engine.battleConfig[storageKey];
  if (config) {
    for (let i = 0; i < p0Team.length; i++) config.p0States[i] ??= Structs.createDefaultMonState();
    for (let i = 0; i < p1Team.length; i++) config.p1States[i] ??= Structs.createDefaultMonState();
  }

  return battleKey;
}

// =============================================================================
// Per-turn execution + frame capture
// =============================================================================

export interface TurnInputs {
  p0MoveIndex: bigint;
  p0Salt: string;      // 0x-prefixed (typically 26 hex nibbles uint104, but Engine
                       //              hashes it via abi.encode(bytes32, bytes32))
  p0ExtraData: bigint;
  p1MoveIndex: bigint;
  p1Salt: string;
  p1ExtraData: bigint;
}

function pad32(salt: string): string {
  // The transpiled oracle treats both salts as bytes32. Pad the on-chain
  // uint104 salt up to 32 bytes (matching how the chain encodes it).
  let s = salt.startsWith('0x') ? salt.slice(2) : salt;
  if (s.length > 64) s = s.slice(-64);
  return '0x' + s.padStart(64, '0');
}

export function executeTurn(
  bundle: HarnessBundle,
  battleKey: `0x${string}`,
  inputs: TurnInputs,
): void {
  const { engine } = bundle;
  Contract._currentCaller = HARNESS_MOVE_MANAGER;
  engine.setMove(battleKey, 0n, inputs.p0MoveIndex, pad32(inputs.p0Salt), inputs.p0ExtraData);
  engine.setMove(battleKey, 1n, inputs.p1MoveIndex, pad32(inputs.p1Salt), inputs.p1ExtraData);
  engine._block.timestamp = engine._block.timestamp + 1n;
  engine.execute(battleKey);
  Contract._currentCaller = ADDRESS_ZERO;
}

// =============================================================================
// Frame snapshot
// =============================================================================

const SENTINEL = Constants.CLEARED_MON_STATE_SENTINEL;

const ADDRESS_TO_NAME: Map<string, string> = (() => {
  const m = new Map<string, string>();
  const prettify = (key: string) =>
    key.toLowerCase().split('_').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
  for (const [key, addr] of Object.entries(MAINNET_ADDRESSES)) {
    const lower160 = isInlineAddress(addr)
      ? '0x' + (BigInt(addr) & ((1n << 160n) - 1n)).toString(16).padStart(40, '0')
      : addr;
    m.set(lower160.toLowerCase(), prettify(key));
  }
  return m;
})();

function effectName(effect: any): string {
  const addr = (effect?.effect?._contractAddress ?? '').toLowerCase();
  if (addr) {
    const named = ADDRESS_TO_NAME.get(addr);
    if (named) return named;
  }
  const ctor = effect?.effect?.constructor?.name;
  if (ctor && ctor !== 'Object' && ctor !== 'Proxy') return ctor;
  return addr ? `Effect(${addr.slice(0, 10)}…)` : 'UnknownEffect';
}

function describeEffect(effect: any): EffectFrame {
  return {
    name: effectName(effect),
    extraData: effect?.extraData ?? '0x',
  };
}

function buildMonFrame(
  monId: number,
  slot: number,
  baseMon: Structs.Mon,
  state: Structs.MonState,
  effects: any[] | undefined,
): MonFrame {
  const entry = MON_CATALOG[monId];
  const name = entry?.name ?? `Slot ${slot}`;
  const norm = (v: bigint) => (v === SENTINEL ? 0n : v);
  const maxHp = Number(baseMon.stats.hp);
  const maxStamina = Number(baseMon.stats.stamina);
  return {
    slot,
    id: monId,
    name,
    maxHp,
    hp: maxHp + Number(norm(state.hpDelta)),
    maxStamina,
    stamina: maxStamina + Number(norm(state.staminaDelta)),
    isKnockedOut: Boolean(state.isKnockedOut),
    shouldSkipTurn: Boolean(state.shouldSkipTurn),
    effects: (effects || []).map(describeEffect),
  };
}

export function snapshotFrame(
  bundle: HarnessBundle,
  battleKey: `0x${string}`,
  monIds: [number[], number[]],
  moves: MoveDescription[],
): TimelineFrame {
  const { engine } = bundle;
  const [configView, battleData] = engine.getBattle(battleKey) as [Structs.BattleConfigView, Structs.BattleData];
  const activeIndices = engine.getActiveMonIndexForBattleState(battleKey) as bigint[];

  const events = globalEventStream.getAll().map((e: any) => ({ name: e.eventName ?? e.name ?? '?', data: e.args ?? e.data ?? {} }));
  globalEventStream.clear();

  const p0Mons = configView.teams[0].map((mon, i) =>
    buildMonFrame(monIds[0][i] ?? -1, i, mon, configView.monStates[0][i], configView.p0Effects?.[i]));
  const p1Mons = configView.teams[1].map((mon, i) =>
    buildMonFrame(monIds[1][i] ?? -1, i, mon, configView.monStates[1][i], configView.p1Effects?.[i]));

  return {
    turnId: Number(battleData.turnId),
    activeMonIndex: [Number(activeIndices[0]), Number(activeIndices[1])],
    p0Mons,
    p1Mons,
    globalEffects: (configView.globalEffects || []).map(describeEffect),
    winnerIndex: Number(battleData.winnerIndex) as 0 | 1 | 2,
    moves,
    events,
  };
}
