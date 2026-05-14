# Stomp History

Terminal-first read-only battle history viewer for [stomp.gg](https://stomp.gg), an on-chain monster battler on MegaETH.

The tool lets you paste a player address, fetch public battle history, choose a battle from the terminal, and inspect the move sequence in a readable format. It does not connect to a wallet, does not read browser storage, and cannot sign or send transactions.

## Features

- Finds battles for an address through MegaETH Blockscout and public RPC.
- Decodes `BattleStart`, `MonMove` / `MonMoves`, `EngineExecute`, and `BattleComplete` events.
- Resolves player/opponent, winner, turn count, move count, teams, mon names, switches, rests, and move names when team data is available.
- Decodes CPU battles, direct Engine starts, and PvP battles started through `SignedMatchmaker.startGame`.
- Terminal-first workflow, with optional JSON, Markdown, and local web output.
- Uses only Python standard library.

## Terminal Quick Start

Clone the repo:

```bash
git clone https://github.com/illlefr4u/stomp-history.git
cd stomp-history
```

Start with the terminal viewer:

```bash
python3 stomp_history.py 0x341cab8a3e3f09093b63967369c38d8df46aa1f9 --terminal --limit 15
```

Select a row number to inspect its turn-by-turn move sequence. The list also
shows `P#`, a stable player battle number where the oldest discovered battle is
`0`; type `p23` to open player battle `23`.

To print one battle directly:

```bash
python3 stomp_history.py 0x341cab8a3e3f09093b63967369c38d8df46aa1f9 --battle 1 --limit 15
```

Or use the stable player battle number:

```bash
python3 stomp_history.py 0x341cab8a3e3f09093b63967369c38d8df46aa1f9 --player-battle 23 --limit 30
```

## Optional Web Viewer

The web viewer is a secondary local UI over the same data. It waits for the user
to click `Fetch` by default and does not fetch on page load unless `auto=true`
is set explicitly.

```bash
python3 server.py
```

Open:

```text
http://127.0.0.1:8765
```

Then paste an address and click `Fetch`, for example:

```text
0x341cab8a3e3f09093b63967369c38d8df46aa1f9
```

Query params can prefill the form, for example
`?address=0x...&limit=15&scanStarts=false`. Add `&auto=true` only when you
want the page to fetch immediately on load.

## Markdown / JSON CLI

```bash
python3 stomp_history.py 0x341cab8a3e3f09093b63967369c38d8df46aa1f9 \
  --out out/history.json \
  --md-out out/history.md
```

For a copy-paste chat summary:

```bash
python3 stomp_history.py 0x341cab8a3e3f09093b63967369c38d8df46aa1f9 \
  --limit 8 \
  --share
```

For PvP games that may have been started by the opponent, enable a `BattleStart` scan:

```bash
python3 stomp_history.py 0x341cab8a3e3f09093b63967369c38d8df46aa1f9 \
  --scan-starts \
  --from-block 15700000
```

`--scan-starts` is slower because `BattleStart` stores player addresses in event data, not indexed topics.

## Web API

Run `python3 server.py`, then call:

```text
GET /api/history?address=0x...&limit=30&scanStarts=false
```

Response shape:

```json
{
  "ok": true,
  "address": "0x...",
  "decodedBattles": 22,
  "wins": 17,
  "losses": 5,
  "battles": [
    {
      "battleKey": "0x...",
      "result": "win",
      "opponentLabel": "Better CPU",
      "teams": {
        "p0": [{"slot": 0, "id": 1, "name": "Inutia"}],
        "p1": [{"slot": 0, "id": 1, "name": "Inutia"}]
      },
      "turns": [
        {
          "turn": 1,
          "moves": [
            {"side": "p0", "activeMon": "Inutia", "label": "Big Bite"}
          ]
        }
      ]
    }
  ]
}
```

## What Is On-Chain

The Engine events expose raw battle flow: battle key, players, winner, turn executions, active mon slot, move index, switch target, and extra data. Human-readable combat text such as exact damage lines is not emitted by the Engine event log.

This viewer reconstructs the readable move sequence from public events plus historical team data.

For full combat (HP, stamina, status ticks, Q5 timers, applied effects), the
optional `replay/` package re-runs each battle through a transpiled copy of the
on-chain Engine and emits a per-turn timeline. The web viewer shows that
timeline next to the on-chain move stream when you click "Run replay" on a
selected battle. See `replay/README.md` for build instructions.

## Network

- Chain: MegaETH mainnet
- Chain ID: `4326`
- RPC: `https://api.moncha.in/rpc/mainnet`
- Explorer: `https://megaeth.blockscout.com/`
- Engine: `0x1119f1e8a53521d0d9bc8ac7db23f33258115e9a`

## Development

```bash
python3 stomp_history.py 0x341cab8a3e3f09093b63967369c38d8df46aa1f9 --limit 5
python3 server.py --port 8765
```

There is intentionally no build step and no wallet integration.

## Optional: Full Combat Replay

```bash
cd replay
npm install
npm run build:engine    # clones chomp, transpiles, writes engine/ (~3s)
```

Once `replay/engine/` exists, `python3 server.py` exposes
`GET /api/replay?address=<addr>&battle=<key>` which pipes the on-chain reveal
stream through the transpiled Engine and returns a per-turn timeline of HP,
stamina, applied effects, and KOs. The web viewer surfaces this with a
"Run replay" button on each battle.

## Roadmap

- Add CSV export for battles and turns.
- Add address labels for known CPU/matchmaker accounts.
- Add caching for repeated team lookups.
- Package the viewer as a small public static/API app.

## License

MIT
