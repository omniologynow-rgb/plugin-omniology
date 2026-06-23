/**
 * config.ts — resolve plugin configuration + load the local signing keypair.
 *
 * 🔐 SECURITY (Plugin Warden, read this):
 *   The Solana private key NEVER leaves this machine. It is read from a local
 *   file (OMNIOLOGY_KEYPAIR_PATH) ONCE, held only in memory as a web3.js
 *   Keypair, used to sign locally (see client.ts), and is NEVER logged,
 *   serialized, transmitted, or sent to the Omniology server. The server only
 *   ever receives: your public wallet address, a detached signature, and a
 *   broadcast transaction signature — never the key itself.
 */

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { Keypair } from '@solana/web3.js';
import type { IAgentRuntime } from '@elizaos/core';

export interface OmniologyConfig {
  apiBase: string;
  agentId?: string;
  keypairPath?: string;
  solanaRpcUrl: string;
}

const DEFAULT_API_BASE = 'https://omniology-engine.fly.dev/v1';
const DEFAULT_SOLANA_RPC = 'https://api.mainnet-beta.solana.com';

/** Read a setting from the ElizaOS runtime first, then process.env. */
function setting(runtime: IAgentRuntime | undefined, key: string): string | undefined {
  const fromRuntime = runtime?.getSetting?.(key) as string | undefined;
  const v = fromRuntime ?? process.env[key];
  return v ? String(v) : undefined;
}

/** Resolve config. Never throws — actions validate what they actually need. */
export function getConfig(runtime?: IAgentRuntime): OmniologyConfig {
  const apiBase = (setting(runtime, 'OMNIOLOGY_API_BASE') ?? DEFAULT_API_BASE).replace(/\/+$/, '');
  return {
    apiBase,
    agentId: setting(runtime, 'OMNIOLOGY_AGENT_ID'),
    keypairPath: setting(runtime, 'OMNIOLOGY_KEYPAIR_PATH'),
    solanaRpcUrl: setting(runtime, 'OMNIOLOGY_SOLANA_RPC') ?? DEFAULT_SOLANA_RPC,
  };
}

/** Expand a leading ~ to the user's home directory (Node does not do this). */
function expandHome(p: string): string {
  return p.startsWith('~') ? resolve(homedir(), p.slice(1).replace(/^[/\\]/, '')) : resolve(p);
}

/**
 * 🔐 Load the signing keypair from OMNIOLOGY_KEYPAIR_PATH. The file is the
 * standard Solana keypair JSON (a 64-byte secret-key array). Loaded fresh each
 * call by the signer; never cached to a global, never logged. Throws a clear,
 * key-free error if the path is unset or the file is malformed.
 */
export function loadKeypair(keypairPath: string | undefined): Keypair {
  if (!keypairPath) {
    throw new Error(
      'OMNIOLOGY_KEYPAIR_PATH is not set — required to sign entries locally. ' +
        'Point it at your Solana keypair JSON file.',
    );
  }
  let raw: string;
  try {
    raw = readFileSync(expandHome(keypairPath), 'utf8');
  } catch {
    throw new Error(`Could not read keypair at OMNIOLOGY_KEYPAIR_PATH (${keypairPath}).`);
  }
  let secret: number[];
  try {
    secret = JSON.parse(raw) as number[];
  } catch {
    throw new Error('Keypair file is not valid JSON (expected a secret-key byte array).');
  }
  if (!Array.isArray(secret) || (secret.length !== 64 && secret.length !== 32)) {
    throw new Error('Keypair file must be a 32- or 64-byte secret-key array.');
  }
  // In-memory only. Never logged, never serialized back out.
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}
