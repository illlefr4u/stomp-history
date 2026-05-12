# Security

Stomp History is intentionally read-only.

It only calls:

- MegaETH public JSON-RPC
- MegaETH Blockscout API

It does not:

- connect to a wallet
- request signatures
- send transactions
- read browser storage
- ask for private keys or seed phrases

If you find behavior that violates this model, open an issue with reproduction steps and the exact command or URL used.
