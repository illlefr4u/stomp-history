// Node CLI: replays a stomp battle from on-chain inputs and prints a JSON
// timeline to stdout. Used by stomp-history's server.py as a subprocess.
//
// Input format (stdin JSON):
//   {
//     "battleKey": "0x...",
//     "p0": "0x...", "p1": "0x...",
//     "p0MonIds": [n,n,n,n],
//     "p1MonIds": [n,n,n,n],
//     "turns": [
//       { "p0": { "moveIndex": n, "salt": "0x...", "extraData": "0x..."|0|null },
//         "p1": { "moveIndex": n, "salt": "0x...", "extraData": "0x..."|0|null } }
//     ]
//   }
//
// Output format (stdout JSON): { ok: true, frames: TimelineFrame[] }

import { readFileSync } from 'fs';
import * as Constants from '../engine/Constants';
import {
  makeHarness,
  startBattle,
  executeTurn,
  snapshotFrame,
  type MoveDescription,
  type TimelineFrame,
} from './harness';
import { MON_CATALOG } from './data/mons';

interface RawMove {
  moveIndex: number | string;
  salt: string;
  extraData?: number | string | null;
}

interface ReplayInputs {
  p0: string;
  p1: string;
  p0MonIds: number[];
  p1MonIds: number[];
  turns: Array<{ p0: RawMove | null; p1: RawMove | null }>;
}

const FRIEND_TARGET_MOVES = new Set(['Hit And Dip', 'Round Trip', 'Guest Feature', 'Gilded Recovery']);
const OPPONENT_TARGET_MOVES = new Set(['Sneak Attack']);

function bi(x: number | string | bigint | null | undefined): bigint {
  if (x === null || x === undefined) return 0n;
  if (typeof x === 'bigint') return x;
  if (typeof x === 'number') return BigInt(x);
  const s = x.toString().trim();
  if (s === '') return 0n;
  return s.startsWith('0x') ? BigInt(s) : BigInt(s);
}

function describeMove(
  side: 'p0' | 'p1',
  raw: RawMove | null,
  activeMonIndex: number,
  p0MonIds: number[],
  p1MonIds: number[],
): MoveDescription {
  const ownIds = side === 'p0' ? p0MonIds : p1MonIds;
  const oppIds = side === 'p0' ? p1MonIds : p0MonIds;
  const activeMonId = ownIds[activeMonIndex];
  const activeMon = MON_CATALOG[activeMonId]?.name ?? `Slot ${activeMonIndex}`;

  if (!raw) {
    return { side, moveIndex: -1, label: 'no-op', activeMonIndex, activeMon };
  }

  const moveIndex = Number(raw.moveIndex);
  const extra = Number(bi(raw.extraData));

  if (BigInt(moveIndex) === Constants.SWITCH_MOVE_INDEX) {
    const target = MON_CATALOG[ownIds[extra]]?.name ?? `Slot ${extra}`;
    return { side, moveIndex, label: `Switch -> ${target}`, activeMonIndex, activeMon, target };
  }
  if (BigInt(moveIndex) === Constants.NO_OP_MOVE_INDEX) {
    return { side, moveIndex, label: 'Rest / no-op', activeMonIndex, activeMon };
  }

  const slot = moveIndex; // setMove takes the user-facing 0..3 index
  const monMoves = MON_CATALOG[activeMonId]?.moves ?? [];
  const moveName = monMoves[slot] ? prettyMoveName(monMoves[slot]) : `move[${slot}]`;
  let target: string | undefined;
  if (FRIEND_TARGET_MOVES.has(moveName)) target = MON_CATALOG[ownIds[extra]]?.name;
  else if (OPPONENT_TARGET_MOVES.has(moveName)) target = MON_CATALOG[oppIds[extra]]?.name;
  return {
    side,
    moveIndex: slot,
    label: target ? `${moveName} -> ${target}` : moveName,
    activeMonIndex,
    activeMon,
    target,
  };
}

function prettyMoveName(key: string): string {
  return key.toLowerCase().split('_').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
}

function readAllStdin(): string {
  return readFileSync(0, 'utf-8');
}

function main(): void {
  const raw = readAllStdin();
  let input: ReplayInputs;
  try {
    input = JSON.parse(raw);
  } catch (err) {
    process.stdout.write(JSON.stringify({ ok: false, error: `bad JSON input: ${(err as Error).message}` }));
    process.exit(2);
  }

  const bundle = makeHarness();
  const battleKey = startBattle(bundle, {
    p0: input.p0,
    p1: input.p1,
    p0MonIds: input.p0MonIds,
    p1MonIds: input.p1MonIds,
  });

  const frames: TimelineFrame[] = [];

  // Pre-battle frame: nothing executed yet, no active mons.
  frames.push(snapshotFrame(bundle, battleKey, [input.p0MonIds, input.p1MonIds], []));

  for (let i = 0; i < input.turns.length; i++) {
    const t = input.turns[i];
    const prev = frames[frames.length - 1];
    const [p0Active, p1Active] = prev.activeMonIndex;
    const moves: MoveDescription[] = [
      describeMove('p0', t.p0, p0Active, input.p0MonIds, input.p1MonIds),
      describeMove('p1', t.p1, p1Active, input.p0MonIds, input.p1MonIds),
    ];

    try {
      executeTurn(bundle, battleKey, {
        p0MoveIndex: t.p0 ? bi(t.p0.moveIndex) : Constants.NO_OP_MOVE_INDEX,
        p0Salt: t.p0?.salt ?? '0x' + '00'.repeat(32),
        p0ExtraData: t.p0 ? bi(t.p0.extraData) : 0n,
        p1MoveIndex: t.p1 ? bi(t.p1.moveIndex) : Constants.NO_OP_MOVE_INDEX,
        p1Salt: t.p1?.salt ?? '0x' + '00'.repeat(32),
        p1ExtraData: t.p1 ? bi(t.p1.extraData) : 0n,
      });
    } catch (err) {
      process.stdout.write(JSON.stringify({
        ok: false,
        error: `engine threw on turn ${i + 1}: ${(err as Error).message}`,
        frames,
      }));
      return;
    }

    frames.push(snapshotFrame(bundle, battleKey, [input.p0MonIds, input.p1MonIds], moves));

    if (frames[frames.length - 1].winnerIndex !== 2) break;
  }

  process.stdout.write(JSON.stringify({ ok: true, frames }, (_k, v) =>
    typeof v === 'bigint' ? v.toString() : v));
}

main();
