#!/usr/bin/env python3
"""Read and render Stomp.gg on-chain battle history by player address.

The tool is read-only: it uses public MegaETH RPC and Blockscout endpoints,
does not inspect browser storage, and never signs or sends transactions.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any


RPC_URL = "https://api.moncha.in/rpc/mainnet"
BLOCKSCOUT_API = "https://megaeth.blockscout.com/api"
BLOCKSCOUT_TX = "https://megaeth.blockscout.com/tx"
ENGINE = "0x1119f1e8a53521d0d9bc8ac7db23f33258115e9a"
ENGINE_DEPLOY_BLOCK = 13_937_945

BATTLE_START_TOPIC = "0xc98a63251477c86868d22927e6d2eb866541432ec5492553e7b138d7c88182d0"
MON_MOVE_TOPIC = "0x80ecec4cf9d93350ff0674989692e23b35df607d30a9bb6cb2bbac880c6b4616"
MON_MOVES_TOPIC = "0x3784e8dc298a9a81d0005fc2c9896bcd38dc53f63be5ada5f9dce22e16ce730e"
ENGINE_EXECUTE_TOPIC = "0xc2e4c95b3a649308853b094c2ee8d4fe3b2d319dd833542a728a50b8c87a6f12"
BATTLE_COMPLETE_TOPIC = "0xe005de304818e43b723cc0ca12187fb5687c459ce310f061200b543eaa29465a"

GACHA_TEAM_REGISTRY = "0xb085ae358c01d9b213468cfbd791d69f05cec008"
OKAY_CPU = "0x7e725c54c9a1c0f19c0a969bdfa1004edccd6d8c"
BETTER_CPU = "0x183afbbca127cbef02426abed18d983c85dce0ab"

GET_TEAM_IDS_SELECTOR = "0xc1316137"  # getMonRegistryIndicesForTeam(address,uint256)
CPU_START_BATTLE_SELECTOR = "0x10d136b0"
ENGINE_START_BATTLE_SELECTOR = "0x9c4f2a78"
SIGNED_MATCHMAKER_START_GAME_SELECTOR = "0xe6125c78"  # startGame(BattleOffer,bytes)

NO_OP_MOVE_INDEX = 126
SWITCH_MOVE_INDEX = 125
MOVE_INDEX_MASK = 0x7F
IS_REAL_TURN_BIT = 0x80

MON_NAMES = {
    0: "Ghouliath",
    1: "Inutia",
    2: "Malalien",
    3: "Iblivion",
    4: "Gorillax",
    5: "Sofabbi",
    6: "Pengym",
    7: "Embursa",
    8: "Volthare",
    9: "Aurox",
    10: "Xmon",
    11: "Ekineki",
    12: "Nirvamma",
}

MOVE_NAMES_BY_MON = {
    "Ghouliath": ["Eternal Grudge", "Infernal Flame", "Wither Away", "Osteoporosis"],
    "Gorillax": ["Rock Pull", "Pound Ground", "Blow", "Throw Pebble"],
    "Iblivion": ["Unbounded Strike", "Loop", "Brightback", "Renormalize"],
    "Inutia": ["Chain Expansion", "Initialize", "Big Bite", "Hit And Dip"],
    "Malalien": ["Triple Think", "Federal Investigation", "Negative Thoughts", "Infinite Love"],
    "Pengym": ["Chill Out", "Deadlift", "Deep Freeze", "Pistol Squat"],
    "Sofabbi": ["Gachachacha", "Guest Feature", "Unexpected Carrot", "Snack Break"],
    "Volthare": ["Electrocute", "Round Trip", "Mega Star Blast", "Dual Shock"],
    "Embursa": ["Honey Bribe", "Set Ablaze", "Heat Beacon", "Q5"],
    "Aurox": ["Volatile Punch", "Gilded Recovery", "Iron Wall", "Bull Rush"],
    "Xmon": ["Contagious Slumber", "Vital Siphon", "Somniphobia", "Night Terrors"],
    "Ekineki": ["Bubble Bop", "Sneak Attack", "Nine Nine Nine", "Overflow"],
    "Nirvamma": ["Hard Reset", "Scary Numbers", "Chronoffense", "Modal Bolt"],
}

FRIEND_TARGET_MOVES = {"Hit And Dip", "Round Trip", "Guest Feature", "Gilded Recovery"}
OPPONENT_TARGET_MOVES = {"Sneak Attack"}

ADDRESS_LABELS = {
    OKAY_CPU: "Okay CPU",
    BETTER_CPU: "Better CPU",
}


@dataclass
class BattleHit:
    battle_key: str
    source: str
    block_number: int | None = None
    tx_hash: str | None = None
    p0: str | None = None
    p1: str | None = None


class HistoryError(RuntimeError):
    pass


def http_json(url: str, payload: dict[str, Any] | None = None, timeout: int = 30) -> Any:
    headers = {
        "accept": "application/json",
        "user-agent": "stomp-history/0.1 (+https://stomp.gg)",
    }
    if payload is None:
        req = urllib.request.Request(url, headers=headers)
    else:
        body = json.dumps(payload).encode()
        req = urllib.request.Request(
            url,
            data=body,
            headers={**headers, "content-type": "application/json"},
        )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode())


def rpc(method: str, params: list[Any]) -> Any:
    data = http_json(RPC_URL, {"jsonrpc": "2.0", "id": 1, "method": method, "params": params})
    if "error" in data:
        raise HistoryError(f"RPC {method} failed: {data['error']}")
    return data["result"]


def blockscout(params: dict[str, Any]) -> Any:
    query = urllib.parse.urlencode(params)
    data = http_json(f"{BLOCKSCOUT_API}?{query}")
    if data.get("status") == "0" and data.get("message") not in {"No records found", "OK"}:
        raise HistoryError(f"Blockscout failed: {data}")
    return data.get("result") or []


def h2i(value: str | int | None) -> int | None:
    if value is None:
        return None
    if isinstance(value, int):
        return value
    if value.startswith("0x"):
        return int(value, 16)
    return int(value)


def norm_addr(addr: str) -> str:
    addr = addr.strip().lower()
    if not addr.startswith("0x"):
        addr = "0x" + addr
    if len(addr) != 42:
        raise ValueError(f"not an EVM address: {addr}")
    int(addr, 16)
    return addr


def norm_hash(value: str) -> str:
    value = value.strip().lower()
    if not value.startswith("0x"):
        value = "0x" + value
    if len(value) != 66:
        raise ValueError(f"not a bytes32 value: {value}")
    int(value, 16)
    return value


def word_at(data: str, index: int) -> int:
    raw = data[2:] if data.startswith("0x") else data
    start = index * 64
    return int(raw[start : start + 64] or "0", 16)


def addr_from_word(value: int) -> str:
    return f"0x{value & ((1 << 160) - 1):040x}"


def enc_addr(addr: str) -> str:
    return norm_addr(addr)[2:].rjust(64, "0")


def enc_uint(value: int) -> str:
    return f"{value:x}".rjust(64, "0")


def short_hash(value: str | None, left: int = 10, right: int = 6) -> str:
    if not value:
        return "?"
    return f"{value[:left]}...{value[-right:]}"


def label_addr(addr: str | None) -> str:
    if not addr:
        return "?"
    addr = addr.lower()
    return ADDRESS_LABELS.get(addr, short_hash(addr, 8, 4))


def decode_battle_start(log: dict[str, Any]) -> tuple[str, str]:
    return addr_from_word(word_at(log["data"], 0)), addr_from_word(word_at(log["data"], 1))


def decode_move_index(packed: int) -> dict[str, Any]:
    stored = packed & 0xFF
    real_turn = bool(stored & IS_REAL_TURN_BIT)
    masked = stored & MOVE_INDEX_MASK
    if masked == SWITCH_MOVE_INDEX:
        label = "switch"
        move_index = SWITCH_MOVE_INDEX
    elif masked == NO_OP_MOVE_INDEX:
        label = "rest/no-op"
        move_index = NO_OP_MOVE_INDEX
    elif masked == 0:
        label = "unset"
        move_index = None
    else:
        move_index = masked - 1
        label = f"move[{move_index}]"
    return {
        "raw": stored,
        "realTurn": real_turn,
        "masked": masked,
        "moveIndex": move_index,
        "label": label,
    }


def decode_old_mon_move(log: dict[str, Any]) -> dict[str, Any]:
    packed_player_mon = word_at(log["data"], 0)
    packed_move_extra = word_at(log["data"], 1)
    salt_word = log["data"][2 + 64 * 2 : 2 + 64 * 3]
    return {
        "event": "MonMove",
        "playerIndex": packed_player_mon >> 8,
        "activeMonIndex": packed_player_mon & 0xFF,
        "move": decode_move_index(packed_move_extra),
        "extraData": packed_move_extra >> 8,
        "salt": "0x" + salt_word,
    }


def decode_new_mon_moves(log: dict[str, Any]) -> list[dict[str, Any]]:
    packed_moves = word_at(log["data"], 0)
    packed_salts = word_at(log["data"], 1)
    salt_mask = (1 << 104) - 1
    out: list[dict[str, Any]] = []
    for player_index, shift in ((0, 0), (1, 32)):
        packed_move_index = (packed_moves >> (shift + 8)) & 0xFF
        out.append(
            {
                "event": "MonMove",
                "playerIndex": player_index,
                "activeMonIndex": (packed_moves >> shift) & 0xFF,
                "move": decode_move_index(packed_move_index),
                "extraData": (packed_moves >> (shift + 16)) & 0xFFFF,
                "salt": f"0x{((packed_salts >> (player_index * 104)) & salt_mask):026x}",
                "sourceEvent": "MonMoves",
            }
        )
    return out


def with_log_base(log: dict[str, Any], item: dict[str, Any]) -> dict[str, Any]:
    return {
        "topic0": log["topics"][0].lower(),
        "blockNumber": h2i(log.get("blockNumber")),
        "transactionHash": log.get("transactionHash"),
        "logIndex": h2i(log.get("logIndex")),
        "battleKey": log["topics"][1].lower() if len(log.get("topics", [])) > 1 else None,
        **item,
    }


def decode_log(log: dict[str, Any]) -> list[dict[str, Any]]:
    topic0 = log["topics"][0].lower()
    if topic0 == BATTLE_START_TOPIC:
        p0, p1 = decode_battle_start(log)
        return [with_log_base(log, {"event": "BattleStart", "p0": p0, "p1": p1})]
    if topic0 == MON_MOVE_TOPIC:
        return [with_log_base(log, decode_old_mon_move(log))]
    if topic0 == MON_MOVES_TOPIC:
        return [with_log_base(log, item) for item in decode_new_mon_moves(log)]
    if topic0 == ENGINE_EXECUTE_TOPIC:
        return [with_log_base(log, {"event": "EngineExecute"})]
    if topic0 == BATTLE_COMPLETE_TOPIC:
        return [with_log_base(log, {"event": "BattleComplete", "winner": addr_from_word(word_at(log["data"], 0))})]
    return [with_log_base(log, {"event": "Unknown"})]


def tx_by_hash(tx_hash: str) -> dict[str, Any] | None:
    if not tx_hash:
        return None
    tx = rpc("eth_getTransactionByHash", [tx_hash])
    return tx or None


def calldata_words(input_hex: str) -> list[int]:
    raw = input_hex[10:] if input_hex.startswith("0x") else input_hex[8:]
    return [int(raw[i : i + 64] or "0", 16) for i in range(0, len(raw), 64)]


def parse_start_tx(input_hex: str) -> dict[str, Any] | None:
    if not input_hex or len(input_hex) < 10:
        return None
    selector = input_hex[:10].lower()
    if selector not in {CPU_START_BATTLE_SELECTOR, ENGINE_START_BATTLE_SELECTOR, SIGNED_MATCHMAKER_START_GAME_SELECTOR}:
        return None
    words = calldata_words(input_hex)
    if not words:
        return None
    if selector == SIGNED_MATCHMAKER_START_GAME_SELECTOR:
        return parse_signed_matchmaker_start(words, selector)
    base = words[0] // 32 if len(words) > 1 and words[0] % 32 == 0 else 0
    try:
        if selector == CPU_START_BATTLE_SELECTOR:
            return {
                "selector": selector,
                "kind": "CPU.startBattle(ProposedBattle)",
                "p0": addr_from_word(words[base + 0]),
                "p0TeamIndex": words[base + 1],
                "p1": addr_from_word(words[base + 3]),
                "p1TeamIndex": words[base + 4],
                "teamRegistry": addr_from_word(words[base + 5]),
            }
        return {
            "selector": selector,
            "kind": "Engine.startBattle(Battle)",
            "p0": addr_from_word(words[base + 0]),
            "p0TeamIndex": words[base + 1],
            "p1": addr_from_word(words[base + 2]),
            "p1TeamIndex": words[base + 3],
            "teamRegistry": addr_from_word(words[base + 4]),
        }
    except IndexError:
        return None


def parse_signed_matchmaker_start(words: list[int], selector: str) -> dict[str, Any] | None:
    """Decode SignedMatchmaker.startGame(BattleOffer,bytes).

    ABI shape:
      startGame(((Battle,uint256) offer), bytes p0Signature)
      Battle = (
        address p0, uint96 p0TeamIndex, address p1, uint96 p1TeamIndex,
        address teamRegistry, address validator, address rngOracle,
        address ruleset, address moveManager, address matchmaker,
        address[] engineHooks
      )

    Open offers are submitted with p1=address(0). The matchmaker rewrites p1
    to msg.sender before calling Engine.startBattle; enrich_teams patches that
    from the BattleStart event.
    """
    try:
        offer_offset_words = words[0] // 32
        offer_base = offer_offset_words
        battle_base = offer_base + (words[offer_base] // 32)
        return {
            "selector": selector,
            "kind": "SignedMatchmaker.startGame(BattleOffer,bytes)",
            "p0": addr_from_word(words[battle_base + 0]),
            "p0TeamIndex": words[battle_base + 1],
            "p1": addr_from_word(words[battle_base + 2]),
            "p1TeamIndex": words[battle_base + 3],
            "teamRegistry": addr_from_word(words[battle_base + 4]),
            "validator": addr_from_word(words[battle_base + 5]),
            "rngOracle": addr_from_word(words[battle_base + 6]),
            "ruleset": addr_from_word(words[battle_base + 7]),
            "moveManager": addr_from_word(words[battle_base + 8]),
            "matchmaker": addr_from_word(words[battle_base + 9]),
            "pairHashNonce": words[offer_base + 1],
        }
    except IndexError:
        return None


def eth_call(to: str, data: str, block_number: int | None = None) -> str:
    block_tag = hex(block_number) if block_number is not None else "latest"
    return rpc("eth_call", [{"to": norm_addr(to), "data": data}, block_tag])


def decode_uint_array(result: str) -> list[int]:
    if not result or result == "0x":
        return []
    offset = word_at(result, 0)
    start = offset // 32
    length = word_at(result, start)
    return [word_at(result, start + 1 + i) for i in range(length)]


def get_team_ids(registry: str, player: str, team_index: int, block_number: int | None) -> list[int]:
    data = "0x" + GET_TEAM_IDS_SELECTOR[2:] + enc_addr(player) + enc_uint(team_index)
    return decode_uint_array(eth_call(registry, data, block_number))


def team_from_ids(ids: list[int]) -> list[dict[str, Any]]:
    return [{"slot": i, "id": mon_id, "name": MON_NAMES.get(mon_id, f"Mon #{mon_id}")} for i, mon_id in enumerate(ids)]


def get_logs_for_battle(battle_key: str, from_block: int = ENGINE_DEPLOY_BLOCK) -> list[dict[str, Any]]:
    logs = rpc(
        "eth_getLogs",
        [
            {
                "fromBlock": hex(from_block),
                "toBlock": "latest",
                "address": ENGINE,
                "topics": [None, battle_key],
            }
        ],
    )
    decoded: list[dict[str, Any]] = []
    for log in logs:
        decoded.extend(decode_log(log))
    decoded.sort(key=lambda x: (x.get("blockNumber") or 0, x.get("logIndex") or 0, x.get("playerIndex") or 0))
    return decoded


def scan_battle_starts(address: str, from_block: int, page_size: int, max_pages: int | None) -> dict[str, BattleHit]:
    hits: dict[str, BattleHit] = {}
    page = 1
    while True:
        rows = blockscout(
            {
                "module": "logs",
                "action": "getLogs",
                "fromBlock": from_block,
                "toBlock": "latest",
                "address": ENGINE,
                "topic0": BATTLE_START_TOPIC,
                "page": page,
                "offset": page_size,
            }
        )
        if not rows:
            break
        for row in rows:
            p0, p1 = decode_battle_start(row)
            if address in {p0, p1}:
                key = norm_hash(row["topics"][1])
                hits[key] = BattleHit(
                    battle_key=key,
                    source="battleStartScan",
                    block_number=h2i(row.get("blockNumber")),
                    tx_hash=row.get("transactionHash"),
                    p0=p0,
                    p1=p1,
                )
        if len(rows) < page_size:
            break
        page += 1
        if max_pages is not None and page > max_pages:
            break
        time.sleep(0.1)
    return hits


def discover_from_account_txs(address: str, page_size: int, max_pages: int | None) -> dict[str, BattleHit]:
    hits: dict[str, BattleHit] = {}
    page = 1
    while True:
        rows = blockscout(
            {
                "module": "account",
                "action": "txlist",
                "address": address,
                "sort": "desc",
                "page": page,
                "offset": page_size,
            }
        )
        if not rows:
            break
        for tx in rows:
            input_hex = tx.get("input") or "0x"
            if len(input_hex) < 10 + 64:
                continue
            candidate = "0x" + input_hex[10 : 10 + 64]
            candidate_int = int(candidate, 16) if len(candidate) == 66 else 0
            # Battle keys are keccak outputs. Known startBattle calldata begins
            # with a small ABI offset such as 0x20, which is not a battle key.
            if len(candidate) == 66 and candidate_int >= (1 << 128):
                hits.setdefault(
                    norm_hash(candidate),
                    BattleHit(
                        battle_key=norm_hash(candidate),
                        source="accountTxFirstArg",
                        block_number=h2i(tx.get("blockNumber")),
                        tx_hash=tx.get("hash"),
                    ),
                )
        if len(rows) < page_size:
            break
        page += 1
        if max_pages is not None and page > max_pages:
            break
        time.sleep(0.1)
    return hits


def discover_battles(
    address: str,
    page_size: int = 1000,
    max_pages: int | None = None,
    scan_starts: bool = False,
    from_block: int | None = None,
) -> dict[str, BattleHit]:
    hits = discover_from_account_txs(address, page_size, max_pages)
    if scan_starts:
        hit_blocks = [hit.block_number for hit in hits.values() if hit.block_number is not None]
        scan_from = from_block
        if scan_from is None:
            scan_from = max(ENGINE_DEPLOY_BLOCK, min(hit_blocks) - 5000) if hit_blocks else ENGINE_DEPLOY_BLOCK
        hits.update(scan_battle_starts(address, scan_from, page_size, max_pages))
    return hits


def enrich_teams(
    start_tx: str | None,
    start_block: int | None,
    start_p0: str | None = None,
    start_p1: str | None = None,
) -> tuple[dict[str, Any] | None, dict[str, list[dict[str, Any]]]]:
    if not start_tx:
        return None, {}
    tx = tx_by_hash(start_tx)
    meta = parse_start_tx((tx or {}).get("input") or "")
    if not meta:
        return None, {}
    zero = "0x0000000000000000000000000000000000000000"
    if start_p0 and meta.get("p0") == zero:
        meta["p0"] = start_p0
    if start_p1 and meta.get("p1") == zero:
        meta["p1"] = start_p1
    registry = meta.get("teamRegistry") or GACHA_TEAM_REGISTRY
    teams: dict[str, list[dict[str, Any]]] = {}
    for side in ("p0", "p1"):
        player = meta.get(side)
        team_index = meta.get(f"{side}TeamIndex")
        if player is None or team_index is None:
            continue
        try:
            ids = get_team_ids(registry, player, int(team_index), start_block)
        except Exception:
            ids = []
        if ids:
            teams[side] = team_from_ids(ids)
    return meta, teams


def team_mon_name(teams: dict[str, list[dict[str, Any]]], player_index: int, mon_index: int) -> str:
    side = "p0" if player_index == 0 else "p1"
    team = teams.get(side) or []
    if 0 <= mon_index < len(team):
        return team[mon_index]["name"]
    return f"slot {mon_index}"


def describe_move(move_event: dict[str, Any], teams: dict[str, list[dict[str, Any]]]) -> dict[str, Any]:
    player_index = int(move_event["playerIndex"])
    active_index = int(move_event["activeMonIndex"])
    active_name = team_mon_name(teams, player_index, active_index)
    move = move_event["move"]
    move_index = move.get("moveIndex")
    extra = int(move_event.get("extraData") or 0)
    target: str | None = None

    if move_index == SWITCH_MOVE_INDEX:
        action = "Switch"
        target = team_mon_name(teams, player_index, extra)
        label = f"Switch -> {target}"
    elif move_index == NO_OP_MOVE_INDEX:
        action = "Rest / no-op"
        label = action
    elif move_index is None:
        action = "Unset"
        label = action
    else:
        names = MOVE_NAMES_BY_MON.get(active_name) or []
        action = names[move_index] if 0 <= int(move_index) < len(names) else f"move[{move_index}]"
        if action in FRIEND_TARGET_MOVES:
            target = team_mon_name(teams, player_index, extra)
        elif action in OPPONENT_TARGET_MOVES:
            target = team_mon_name(teams, 1 - player_index, extra)
        label = f"{action} -> {target}" if target else action

    return {
        "playerIndex": player_index,
        "side": "p0" if player_index == 0 else "p1",
        "activeMonIndex": active_index,
        "activeMon": active_name,
        "action": action,
        "target": target,
        "label": label,
        "move": move,
        "extraData": extra,
        "blockNumber": move_event.get("blockNumber"),
        "transactionHash": move_event.get("transactionHash"),
        "logIndex": move_event.get("logIndex"),
    }


def build_turns(logs: list[dict[str, Any]], teams: dict[str, list[dict[str, Any]]]) -> list[dict[str, Any]]:
    turns: list[dict[str, Any]] = []
    pending: list[dict[str, Any]] = []
    for item in logs:
        if item["event"] == "MonMove":
            pending.append(describe_move(item, teams))
        elif item["event"] == "EngineExecute":
            turns.append(
                {
                    "turn": len(turns) + 1,
                    "blockNumber": item.get("blockNumber"),
                    "transactionHash": item.get("transactionHash"),
                    "moves": pending,
                }
            )
            pending = []
    if pending:
        turns.append({"turn": len(turns) + 1, "blockNumber": pending[-1].get("blockNumber"), "moves": pending})
    return turns


def summarize_battle(address: str, hit: BattleHit, include_events: bool, enrich: bool = True) -> dict[str, Any] | None:
    narrow_from = max(ENGINE_DEPLOY_BLOCK, (hit.block_number or ENGINE_DEPLOY_BLOCK) - 5000)
    logs = get_logs_for_battle(hit.battle_key, narrow_from)
    if not any(x["event"] == "BattleStart" for x in logs) and narrow_from != ENGINE_DEPLOY_BLOCK:
        logs = get_logs_for_battle(hit.battle_key, ENGINE_DEPLOY_BLOCK)
    if not logs:
        return None

    start = next((x for x in logs if x["event"] == "BattleStart"), None)
    complete = next((x for x in reversed(logs) if x["event"] == "BattleComplete"), None)
    p0 = (start or {}).get("p0") or hit.p0
    p1 = (start or {}).get("p1") or hit.p1
    winner = (complete or {}).get("winner")
    opponent = None
    if p0 and p1:
        opponent = p1 if p0 == address else p0
    result = "unknown"
    if winner:
        result = "win" if winner == address else "loss"

    start_block = (start or {}).get("blockNumber") or hit.block_number
    start_tx = (start or {}).get("transactionHash") or hit.tx_hash
    start_meta = None
    teams: dict[str, list[dict[str, Any]]] = {}
    if enrich:
        try:
            start_meta, teams = enrich_teams(start_tx, start_block, p0, p1)
        except Exception as exc:
            start_meta = {"error": str(exc)}

    moves = [x for x in logs if x["event"] == "MonMove"]
    summary = {
        "battleKey": hit.battle_key,
        "battleUrl": f"{BLOCKSCOUT_TX}/{start_tx}" if start_tx else None,
        "source": hit.source,
        "startBlock": start_block,
        "completeBlock": (complete or {}).get("blockNumber"),
        "startTx": start_tx,
        "completeTx": (complete or {}).get("transactionHash"),
        "p0": p0,
        "p1": p1,
        "playerIndex": 0 if p0 == address else (1 if p1 == address else None),
        "opponent": opponent,
        "opponentLabel": label_addr(opponent),
        "winner": winner,
        "winnerLabel": label_addr(winner),
        "result": result,
        "engineExecutes": sum(1 for x in logs if x["event"] == "EngineExecute"),
        "moveEvents": len(moves),
        "teams": teams,
        "startMeta": start_meta,
        "turns": build_turns(logs, teams),
    }
    if include_events:
        summary["events"] = logs
    else:
        summary["movesPreview"] = moves[:8]
    return summary


def fetch_history(
    address: str,
    limit: int = 30,
    page_size: int = 1000,
    max_pages: int | None = None,
    scan_starts: bool = False,
    from_block: int | None = None,
    include_events: bool = False,
    enrich: bool = True,
) -> dict[str, Any]:
    address = norm_addr(address)
    hits = discover_battles(address, page_size, max_pages, scan_starts, from_block)
    ordered_hits = sorted(hits.values(), key=lambda h: h.block_number or 0, reverse=True)
    numbered_hits = [
        (len(ordered_hits) - index - 1, hit)
        for index, hit in enumerate(ordered_hits)
    ]
    if limit > 0:
        numbered_hits = numbered_hits[:limit]

    battles: list[dict[str, Any]] = []
    warnings: list[str] = []
    for player_battle_number, hit in numbered_hits:
        try:
            summary = summarize_battle(address, hit, include_events, enrich)
        except Exception as exc:
            warnings.append(f"failed to decode {hit.battle_key}: {exc}")
            continue
        if summary:
            summary["playerBattleNumber"] = player_battle_number
            battles.append(summary)

    wins = sum(1 for battle in battles if battle.get("result") == "win")
    losses = sum(1 for battle in battles if battle.get("result") == "loss")
    return {
        "address": address,
        "engine": ENGINE,
        "network": {"name": "MegaETH mainnet", "chainId": 4326, "rpc": RPC_URL},
        "discoveredBattles": len(hits),
        "decodedBattles": len(battles),
        "wins": wins,
        "losses": losses,
        "warnings": warnings,
        "battles": battles,
    }


def render_markdown(payload: dict[str, Any]) -> str:
    address = payload["address"]
    lines = [
        f"# Stomp History - `{address}`",
        "",
        f"Decoded battles: **{payload['decodedBattles']}**. Wins: **{payload['wins']}**. Losses: **{payload['losses']}**.",
        "",
        "| Player # | Battle | Result | Opponent | Teams | Blocks | Turns | Moves |",
        "|---:|---|---|---|---|---:|---:|---:|",
    ]
    for battle in payload["battles"]:
        teams = battle.get("teams") or {}
        our_side = "p0" if battle.get("playerIndex") == 0 else "p1"
        opp_side = "p1" if our_side == "p0" else "p0"
        our_team = "/".join(mon["name"] for mon in teams.get(our_side, [])) or "?"
        opp_team = "/".join(mon["name"] for mon in teams.get(opp_side, [])) or "?"
        blocks = f"{battle.get('startBlock') or '?'}->{battle.get('completeBlock') or '?'}"
        player_number = battle.get("playerBattleNumber")
        player_number_text = "?" if player_number is None else str(player_number)
        battle_label = f"`{short_hash(battle['battleKey'])}`"
        if battle.get("battleUrl"):
            battle_label = f"[{battle_label}]({battle['battleUrl']})"
        lines.append(
            f"| {player_number_text} | {battle_label} | "
            f"{battle['result']} | {battle.get('opponentLabel') or '?'} | {our_team} vs {opp_team} | "
            f"{blocks} | {battle['engineExecutes']} | {battle['moveEvents']} |"
        )
    lines.append("")
    if payload.get("warnings"):
        lines.append("Warnings:")
        lines.extend(f"- {warning}" for warning in payload["warnings"])
        lines.append("")
    lines.append("Source: MegaETH Blockscout + public RPC, read-only.")
    return "\n".join(lines) + "\n"


def render_share_text(payload: dict[str, Any], *, recent: int = 3) -> str:
    """Short copy-paste summary for chat/community posts."""
    address = payload["address"]
    lines = [
        "I made a small read-only Stomp.gg history viewer for MegaETH.",
        "",
        "What it does:",
        "- paste any player address",
        "- finds battles from public Engine events via Blockscout/RPC",
        "- shows W/L, opponent, teams, turn count, move count, and turn-by-turn move sequence",
        "- supports terminal, JSON/Markdown export, and a local web UI",
        "- no wallet connection, no browser storage, no signing, no transactions",
        "",
        f"Demo address: {address}",
        f"Decoded: {payload['decodedBattles']} battles from {payload['discoveredBattles']} discovered ({payload['wins']}W / {payload['losses']}L).",
    ]
    battles = payload.get("battles") or []
    if battles:
        lines.extend(["", "Latest battles:"])
        for battle in battles[:recent]:
            player_number = battle.get("playerBattleNumber")
            player_text = f"P#{player_number}" if player_number is not None else "P#?"
            teams = battle.get("teams") or {}
            our_side = "p0" if battle.get("playerIndex") == 0 else "p1"
            opp_side = "p1" if our_side == "p0" else "p0"
            our_team = "/".join(mon["name"] for mon in teams.get(our_side, [])) or "?"
            opp_team = "/".join(mon["name"] for mon in teams.get(opp_side, [])) or "?"
            lines.append(
                f"- {player_text} {battle['result']}: {our_team} vs {opp_team}, "
                f"{battle['engineExecutes']} turns ({short_hash(battle['battleKey'])})"
            )
    lines.extend(
        [
            "",
            "Run:",
            "```bash",
            "python3 stomp_history.py <address> --terminal --limit 20",
            "python3 server.py  # then open http://127.0.0.1:8765",
            "```",
            "",
            "Caveat: exact damage text is not emitted by the Engine events yet; this reconstructs the on-chain battle/move stream.",
        ]
    )
    return "\n".join(lines)


ANSI = {
    "reset": "\033[0m",
    "bold": "\033[1m",
    "muted": "\033[2m",
    "green": "\033[32m",
    "red": "\033[31m",
    "yellow": "\033[33m",
    "cyan": "\033[36m",
}


def paint(text: str, style: str, enabled: bool) -> str:
    if not enabled:
        return text
    return f"{ANSI[style]}{text}{ANSI['reset']}"


def fit(text: str, width: int) -> str:
    if len(text) <= width:
        return text.ljust(width)
    if width <= 3:
        return text[:width]
    return (text[: width - 3] + "...").ljust(width)


def team_names(battle: dict[str, Any], side: str) -> str:
    team = battle.get("teams", {}).get(side, [])
    return " / ".join(mon["name"] for mon in team) or "?"


def result_label(result: str, color: bool) -> str:
    label = result.upper()
    if result == "win":
        return paint(label, "green", color)
    if result == "loss":
        return paint(label, "red", color)
    return paint(label, "yellow", color)


def render_terminal_list(payload: dict[str, Any], color: bool = True) -> str:
    lines = [
        paint("Stomp History", "bold", color),
        f"Address: {payload['address']}",
        f"Decoded: {payload['decodedBattles']} / Discovered: {payload['discoveredBattles']} / "
        f"Record: {payload['wins']}W-{payload['losses']}L",
        "",
        f"{'#':>3}  {'P#':>4}  {'Result':<7}  {'Opponent':<14}  {'You':<35}  {'Opponent Team':<35}  {'T':>3}  {'M':>3}  Battle",
        "-" * 134,
    ]
    for idx, battle in enumerate(payload["battles"], start=1):
        our_side = "p0" if battle.get("playerIndex") == 0 else "p1"
        opp_side = "p1" if our_side == "p0" else "p0"
        result = result_label(battle["result"], color)
        result_pad = " " * max(0, 7 - len(battle["result"]))
        player_number = battle.get("playerBattleNumber")
        player_number_text = "?" if player_number is None else str(player_number)
        lines.append(
            f"{idx:>3}  {player_number_text:>4}  {result}{result_pad}  "
            f"{fit(battle.get('opponentLabel') or '?', 14)}  "
            f"{fit(team_names(battle, our_side), 35)}  "
            f"{fit(team_names(battle, opp_side), 35)}  "
            f"{battle['engineExecutes']:>3}  {battle['moveEvents']:>3}  "
            f"{short_hash(battle['battleKey'], 12, 8)}"
        )
    if payload.get("warnings"):
        lines.append("")
        lines.append(paint(f"Warnings: {len(payload['warnings'])}", "yellow", color))
        lines.extend(f"- {warning}" for warning in payload["warnings"])
    return "\n".join(lines)


def find_battle_by_player_number(payload: dict[str, Any], player_battle_number: int) -> dict[str, Any]:
    for battle in payload["battles"]:
        if battle.get("playerBattleNumber") == player_battle_number:
            return battle
    raise ValueError(
        f"player battle #{player_battle_number} is not in the loaded result set; increase --limit"
    )


def render_terminal_battle(battle: dict[str, Any], color: bool = True) -> str:
    player_index = battle.get("playerIndex") if battle.get("playerIndex") is not None else 0
    our_side = "p0" if player_index == 0 else "p1"
    opp_side = "p1" if our_side == "p0" else "p0"
    blocks = f"{battle.get('startBlock') or '?'} -> {battle.get('completeBlock') or '?'}"
    player_number = battle.get("playerBattleNumber")
    player_number_line = f"Player battle #: {player_number}" if player_number is not None else "Player battle #: ?"
    lines = [
        paint(short_hash(battle["battleKey"], 18, 10), "bold", color),
        player_number_line,
        f"Result: {result_label(battle['result'], color)}",
        f"Players: {battle.get('p0') or '?'} vs {battle.get('p1') or '?'}",
        f"Blocks: {blocks}",
        f"Turns: {battle['engineExecutes']} / Moves: {battle['moveEvents']}",
        f"You: {team_names(battle, our_side)}",
        f"Opp:  {team_names(battle, opp_side)}",
        "",
    ]
    for turn in battle.get("turns", []):
        tx = short_hash(turn.get("transactionHash"), 10, 6)
        lines.append(paint(f"Turn {turn['turn']}  block {turn.get('blockNumber') or '?'}  tx {tx}", "cyan", color))
        moves = turn.get("moves") or []
        if not moves:
            lines.append("  no decoded moves")
            continue
        for move in moves:
            side = "YOU" if move.get("playerIndex") == player_index else "OPP"
            side_style = "green" if side == "YOU" else "yellow"
            side_label = paint(side, side_style, color)
            side_pad = " " * max(0, 3 - len(side))
            lines.append(
                f"  {side_label}{side_pad}  {move.get('activeMon') or '?'}: {move.get('label') or '?'}"
            )
    return "\n".join(lines)


def render_terminal_battle_by_index(payload: dict[str, Any], battle_index: int, color: bool = True) -> str:
    if battle_index < 1 or battle_index > len(payload["battles"]):
        raise ValueError(f"battle index must be between 1 and {len(payload['battles'])}")
    return render_terminal_battle(payload["battles"][battle_index - 1], color)


def render_terminal_battle_by_player_number(
    payload: dict[str, Any], player_battle_number: int, color: bool = True
) -> str:
    return render_terminal_battle(find_battle_by_player_number(payload, player_battle_number), color)


def parse_terminal_choice(payload: dict[str, Any], choice: str) -> dict[str, Any]:
    if choice.startswith(("p", "#")):
        raw_number = choice[1:]
        if not raw_number.isdigit():
            raise ValueError("use row number like 1, or player battle number like p23")
        return find_battle_by_player_number(payload, int(raw_number))
    if not choice.isdigit():
        raise ValueError("use row number like 1, or player battle number like p23")
    row_index = int(choice)
    if row_index < 1 or row_index > len(payload["battles"]):
        return find_battle_by_player_number(payload, row_index)
    return payload["battles"][row_index - 1]


def run_terminal(payload: dict[str, Any], color: bool = True) -> None:
    while True:
        print()
        print(render_terminal_list(payload, color))
        choice = input("\nSelect row #, player # as pN, or q to quit: ").strip().lower()
        if choice in {"q", "quit", "exit"}:
            return
        if not choice:
            continue
        try:
            battle = parse_terminal_choice(payload, choice)
            print()
            print(render_terminal_battle(battle, color))
            input("\nPress Enter to return to the list...")
        except Exception as exc:
            print(paint(f"Error: {exc}", "red", color))


def main() -> None:
    parser = argparse.ArgumentParser(description="Fetch Stomp.gg on-chain battle history by player address")
    parser.add_argument("address", help="player/game wallet address")
    parser.add_argument("--limit", type=int, default=30, help="max battles to decode")
    parser.add_argument("--page-size", type=int, default=1000)
    parser.add_argument("--max-pages", type=int, default=None, help="cap Blockscout pages for quick tests")
    parser.add_argument("--scan-starts", action="store_true", help="scan BattleStart logs to catch opponent-started games")
    parser.add_argument("--from-block", type=int, default=None, help="BattleStart scan block")
    parser.add_argument("--no-enrich", action="store_true", help="skip team lookup and move-name enrichment")
    parser.add_argument("--events", action="store_true", help="include raw decoded events in JSON output")
    parser.add_argument("--terminal", "-t", action="store_true", help="open an interactive terminal viewer")
    parser.add_argument("--battle", type=int, help="print one battle by 1-based index and exit")
    parser.add_argument("--player-battle", "--pb", type=int, help="print one battle by player battle number, oldest is 0")
    parser.add_argument("--share", action="store_true", help="print a short copy-paste chat summary and exit")
    parser.add_argument("--no-color", action="store_true", help="disable ANSI terminal colors")
    parser.add_argument("--out", type=Path, help="write JSON output")
    parser.add_argument("--md-out", type=Path, help="write Markdown summary")
    args = parser.parse_args()

    payload = fetch_history(
        args.address,
        limit=args.limit,
        page_size=args.page_size,
        max_pages=args.max_pages,
        scan_starts=args.scan_starts,
        from_block=args.from_block,
        include_events=args.events,
        enrich=not args.no_enrich,
    )

    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(payload, indent=2) + "\n")
    if args.md_out:
        args.md_out.parent.mkdir(parents=True, exist_ok=True)
        args.md_out.write_text(render_markdown(payload))

    if args.share:
        print(render_share_text(payload))
        return

    if args.terminal or args.battle or args.player_battle is not None:
        color = not args.no_color and sys.stdout.isatty()
        if args.battle and args.player_battle is not None:
            parser.error("--battle and --player-battle are mutually exclusive")
        if args.player_battle is not None:
            try:
                print(render_terminal_battle_by_player_number(payload, args.player_battle, color))
            except ValueError as exc:
                parser.error(str(exc))
        elif args.battle:
            try:
                print(render_terminal_battle_by_index(payload, args.battle, color))
            except ValueError as exc:
                parser.error(str(exc))
        elif sys.stdin.isatty():
            run_terminal(payload, color)
        else:
            print(render_terminal_list(payload, color))
        return

    print(render_markdown(payload))
    for warning in payload.get("warnings", []):
        print(f"warning: {warning}", file=sys.stderr)
    if args.out:
        print(f"JSON: {args.out}")
    if args.md_out:
        print(f"Markdown: {args.md_out}")


if __name__ == "__main__":
    main()
