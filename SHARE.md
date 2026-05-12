# Share Notes

## Short Post

I made a small terminal-first, read-only Stomp.gg history viewer for MegaETH.

Paste a player address in the terminal and it fetches public on-chain battles from Blockscout/RPC. It shows W/L, opponent, teams, turn count, move count, stable player battle numbers, and a readable turn-by-turn move sequence.

No wallet connection, no browser storage, no signing, no transactions.

Repo:

```text
https://github.com/illlefr4u/stomp-history
```

Terminal:

```bash
git clone https://github.com/illlefr4u/stomp-history.git
cd stomp-history
python3 stomp_history.py <address> --terminal --limit 20
```

Optional local web UI:

```bash
python3 server.py
```

Then open `http://127.0.0.1:8765`, paste an address, and click `Fetch`.

Caveat: the current version reconstructs the on-chain move stream, not full combat text. It shows that `Q5` was selected, but does not yet replay delayed Q5 damage, burn ticks, stat changes, healing, or other applied effects.

## Optional Demo URL

With the local server running:

```text
http://127.0.0.1:8765/?address=0x341cab8a3e3f09093b63967369c38d8df46aa1f9&limit=15&scanStarts=false
```

Add `&auto=true` only if you want the page to fetch immediately on load.

## CLI Share Text

```bash
python3 stomp_history.py 0x341cab8a3e3f09093b63967369c38d8df46aa1f9 --limit 8 --share
```
