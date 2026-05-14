// Mon catalog (id 0..12) for stomp.gg battle replay. Extracted from snack/munch.
// Stats use the canonical "rendered" values that appear on chain for replay;
// stamina starts at 5 for every mon.

import { Type } from '../../engine/Enums';
import type { MonStats, Mon } from '../../engine/Structs';
import { MAINNET_ADDRESSES, isInlineAddress } from './addresses';

export interface MonCatalogEntry {
  id: number;
  name: string;
  type1: Type;
  type2: Type;
  stats: { hp: number; attack: number; defense: number; specialAttack: number; specialDefense: number; speed: number };
  moves: string[];     // Address-keys into MAINNET_ADDRESSES
  ability: string;     // Address-key into MAINNET_ADDRESSES
}

export const MON_CATALOG: Record<number, MonCatalogEntry> = {
  0:  { id: 0,  name: 'Ghouliath', type1: Type.Yin,        type2: Type.Fire,  stats: { hp: 303, attack: 157, defense: 202, specialAttack: 151, specialDefense: 202, speed: 181 }, moves: ['ETERNAL_GRUDGE','INFERNAL_FLAME','WITHER_AWAY','OSTEOPOROSIS'],          ability: 'RISE_FROM_THE_GRAVE' },
  1:  { id: 1,  name: 'Inutia',    type1: Type.Wild,       type2: Type.None,  stats: { hp: 351, attack: 171, defense: 189, specialAttack: 175, specialDefense: 192, speed: 229 }, moves: ['CHAIN_EXPANSION','INITIALIZE','BIG_BITE','HIT_AND_DIP'],              ability: 'INTERWEAVING' },
  2:  { id: 2,  name: 'Malalien',  type1: Type.Cyber,      type2: Type.None,  stats: { hp: 258, attack: 121, defense: 125, specialAttack: 322, specialDefense: 151, speed: 308 }, moves: ['TRIPLE_THINK','FEDERAL_INVESTIGATION','NEGATIVE_THOUGHTS','INFINITE_LOVE'], ability: 'ACTUS_REUS' },
  3:  { id: 3,  name: 'Iblivion',  type1: Type.Yang,       type2: Type.Air,   stats: { hp: 277, attack: 188, defense: 164, specialAttack: 240, specialDefense: 168, speed: 256 }, moves: ['UNBOUNDED_STRIKE','LOOP','BRIGHTBACK','RENORMALIZE'],                 ability: 'BASELIGHT' },
  4:  { id: 4,  name: 'Gorillax',  type1: Type.Earth,      type2: Type.None,  stats: { hp: 407, attack: 302, defense: 175, specialAttack: 112, specialDefense: 176, speed: 129 }, moves: ['ROCK_PULL','POUND_GROUND','BLOW','THROW_PEBBLE'],                     ability: 'ANGERY' },
  5:  { id: 5,  name: 'Sofabbi',   type1: Type.Nature,     type2: Type.None,  stats: { hp: 333, attack: 180, defense: 201, specialAttack: 120, specialDefense: 269, speed: 175 }, moves: ['GACHACHACHA','GUEST_FEATURE','UNEXPECTED_CARROT','SNACK_BREAK'],      ability: 'CARROT_HARVEST' },
  6:  { id: 6,  name: 'Pengym',    type1: Type.Ice,        type2: Type.None,  stats: { hp: 371, attack: 212, defense: 191, specialAttack: 233, specialDefense: 172, speed: 149 }, moves: ['CHILL_OUT','DEADLIFT','DEEP_FREEZE','PISTOL_SQUAT'],                   ability: 'POST_WORKOUT' },
  7:  { id: 7,  name: 'Embursa',   type1: Type.Fire,       type2: Type.None,  stats: { hp: 420, attack: 141, defense: 220, specialAttack: 190, specialDefense: 161, speed: 111 }, moves: ['HONEY_BRIBE','SET_ABLAZE','HEAT_BEACON','Q5'],                         ability: 'TINDERCLAWS' },
  8:  { id: 8,  name: 'Volthare',  type1: Type.Lightning,  type2: Type.Cyber, stats: { hp: 310, attack: 120, defense: 184, specialAttack: 255, specialDefense: 176, speed: 311 }, moves: ['ELECTROCUTE','ROUND_TRIP','MEGA_STAR_BLAST','DUAL_SHOCK'],             ability: 'PREEMPTIVE_SHOCK' },
  9:  { id: 9,  name: 'Aurox',     type1: Type.Metal,      type2: Type.None,  stats: { hp: 400, attack: 150, defense: 230, specialAttack: 100, specialDefense: 220, speed: 100 }, moves: ['VOLATILE_PUNCH','GILDED_RECOVERY','IRON_WALL','BULL_RUSH'],            ability: 'UP_ONLY' },
  10: { id: 10, name: 'Xmon',      type1: Type.Cosmic,     type2: Type.None,  stats: { hp: 311, attack: 123, defense: 179, specialAttack: 222, specialDefense: 185, speed: 285 }, moves: ['CONTAGIOUS_SLUMBER','VITAL_SIPHON','SOMNIPHOBIA','NIGHT_TERRORS'],    ability: 'DREAMCATCHER' },
  11: { id: 11, name: 'Ekineki',   type1: Type.Liquid,     type2: Type.None,  stats: { hp: 299, attack: 130, defense: 180, specialAttack: 280, specialDefense: 175, speed: 266 }, moves: ['BUBBLE_BOP','SNEAK_ATTACK','NINE_NINE_NINE','OVERFLOW'],              ability: 'SAVIOR_COMPLEX' },
  12: { id: 12, name: 'Nirvamma',  type1: Type.Math,       type2: Type.None,  stats: { hp: 373, attack: 202, defense: 168, specialAttack: 140, specialDefense: 202, speed: 177 }, moves: ['HARD_RESET','SCARY_NUMBERS','CHRONOFFENSE','MODAL_BOLT'],              ability: 'ADAPTOR' },
};

export const DEFAULT_STAMINA = 5;

/** Build a Structs.Mon with the catalog's stats + on-chain move/ability addresses. */
export function buildMonFromCatalog(id: number): Mon {
  const entry = MON_CATALOG[id];
  if (!entry) throw new Error(`Unknown mon id=${id}`);

  const stats: MonStats = {
    hp: BigInt(entry.stats.hp),
    stamina: BigInt(DEFAULT_STAMINA),
    speed: BigInt(entry.stats.speed),
    attack: BigInt(entry.stats.attack),
    defense: BigInt(entry.stats.defense),
    specialAttack: BigInt(entry.stats.specialAttack),
    specialDefense: BigInt(entry.stats.specialDefense),
    type1: entry.type1,
    type2: entry.type2,
  };

  const moves = entry.moves.map((key) => {
    const addr = MAINNET_ADDRESSES[key];
    if (!addr) throw new Error(`Missing address for ${key}`);
    // Inline moves carry their packed metadata in the bigint itself; the engine
    // checks the high bits to detect that. Real contracts are stored as the
    // lower-160 uint and looked up through the address registry.
    return BigInt(addr);
  });

  const abilityAddr = MAINNET_ADDRESSES[entry.ability] ?? '0x0000000000000000000000000000000000000000';
  const ability = BigInt(abilityAddr);

  return { stats, moves, ability };
}

export { isInlineAddress };
