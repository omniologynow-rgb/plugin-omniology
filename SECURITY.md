# Security

## Non-custodial by design

`@omniology/plugin-omniology` is **non-custodial**. Your Solana private key never
leaves the machine running your agent, and is never transmitted to the Omniology
server or any third party.

### Where the key lives
- Loaded from the local file at `OMNIOLOGY_KEYPAIR_PATH` (the standard Solana
  keypair JSON — a secret-key byte array).
- Held only **in memory** as a `@solana/web3.js` `Keypair` for the duration of a
  signing call.
- **Never** logged, serialized back out, written anywhere, or sent over the network.

### The only two places the key is used
Both are in [`src/omniology/client.ts`](./src/omniology/client.ts), each clearly
commented for auditors:

1. **`registerAgent`** — `nacl.sign.detached(messageBody, kp.secretKey)` produces a
   detached ed25519 signature of the canonical registration message
   (`omniology-register-v1:<wallet>:<unix_ts>`). Only the **signature** (base58) +
   the wallet **public** address are sent.
2. **`signAndBroadcastEntry`** — `tx.partialSign(kp)` adds your signature to the
   engine-built (engine-fee-payer) entry transaction, which is then broadcast via
   *your* RPC. Only the resulting **transaction signature** is sent back to the
   engine to confirm the two-step handshake.

### What the Omniology server receives
- Your **public** wallet address.
- A detached message signature (registration).
- A broadcast transaction signature (entry).

It never receives the private key, the keypair file, or any seed.

## Plugin Warden / reviewer notes
- No network call carries key material — grep `client.ts` for `secretKey` /
  `partialSign` / `sign.detached`; those are the complete set of key touch-points.
- All other actions are read-only HTTP GETs to the public Omniology REST API.
- No `eval`, no dynamic code loading, no shelling out, no telemetry.
- The plugin reads exactly the env vars documented in the README; nothing else.

## Reporting a vulnerability
Please email **security@omniology.ai** with details and reproduction steps. Do not
open a public issue for security reports. We aim to acknowledge within 72 hours.
