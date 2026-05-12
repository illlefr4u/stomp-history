# Stomp History

Read-only battle history viewer for [stomp.gg](https://stomp.gg), an on-chain monster battler on MegaETH.

The tool lets you paste a player address, fetch public battle history, click a battle, and inspect the move sequence in a readable format. It does not connect to a wallet, does not read browser storage, and cannot sign or send transactions.

## Features

- Finds battles for an address through MegaETH Blockscout and public RPC.
- Decodes `BattleStart`, `MonMove` / `MonMoves`, `EngineExecute`, and `BattleComplete` events.
- Resolves player/opponent, winner, turn count, move count, teams, mon names, switches, rests, and move names when team data is available.
- Decodes CPU battles, direct Engine starts, and PvP battles started through `SignedMatchmaker.startGame`.
- Provides terminal, CLI, and local web UI output.
- Uses only Python standard library.

## Quick Start

Clone the repo:

```bash
git clone https://github.com/illlefr4u/stomp-history.git
cd stomp-history
```

Most users should start with the terminal viewer:

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

## Web Viewer

```bash
python3 server.py
```

Open:

```text
http://127.0.0.1:8765
```

Then paste an address such as:

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

This viewer reconstructs the readable move sequence from public events plus historical team data. Exact damage replay is a separate layer that can be built on top of the same move stream.

Current limitation: applied effects are not replayed yet. For example, if Embursa selects `Q5`, the viewer shows the `Q5` move selection, but it does not yet calculate the delayed Q5 timer, later Q5 damage, burn ticks, stat changes, or healing caused by effects.

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

## Roadmap

- Reconstruct exact damage/heal/status text from the on-chain move stream.
- Add CSV export for battles and turns.
- Add address labels for known CPU/matchmaker accounts.
- Add caching for repeated team lookups.
- Package the viewer as a small public static/API app.

## License

MIT
