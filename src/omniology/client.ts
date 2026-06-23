/**
 * client.ts — thin Omniology REST client + LOCAL transaction signing.
 *
 * Mirrors examples/node-rest-client.js (the proven REST flow) — native fetch,
 * no SDK. Reads need no auth; writes use a wallet-signed message (register) or
 * the two-step enter handshake (submit). The engine never receives a key.
 *
 * 🔐 All private-key use is in this file, in `signRegisterMessage` and
 *    `signAndBroadcastEntry`, both clearly marked. Keys are never logged.
 */

import { Connection, Keypair, Transaction } from '@solana/web3.js';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import type { OmniologyConfig } from './config.js';
import { loadKeypair } from './config.js';

export class OmniologyError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(`[${status} ${code}] ${message}`);
    this.name = 'OmniologyError';
  }
}

async function request<T = any>(
  cfg: OmniologyConfig,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${cfg.apiBase}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as any;
  if (data && data.error) {
    throw new OmniologyError(res.status, data.code ?? 'UNKNOWN', data.message ?? '');
  }
  return data as T;
}

// ── Reads (no auth) ───────────────────────────────────────────────────────────

export const getAgentStatus = (cfg: OmniologyConfig, agentId: string) =>
  request(cfg, 'GET', `/agents/${agentId}/status`);

export const listActiveContests = (cfg: OmniologyConfig, track?: string) =>
  request(cfg, 'GET', `/contests/active${track ? `?track=${encodeURIComponent(track)}` : ''}`);

export const checkPayout = (cfg: OmniologyConfig, entryId: string) =>
  request(cfg, 'GET', `/entries/${entryId}`);

export const getContestRules = (cfg: OmniologyConfig, contestId: string) =>
  request(cfg, 'GET', `/contests/${contestId}`);

export const getLeaderboard = (
  cfg: OmniologyConfig,
  q: { window?: string; track?: string; sort?: string; limit?: number } = {},
) => {
  const params = new URLSearchParams();
  if (q.window) params.set('window', q.window);
  if (q.track) params.set('track', q.track);
  if (q.sort) params.set('sort', q.sort);
  if (q.limit) params.set('limit', String(q.limit));
  const qs = params.toString();
  return request(cfg, 'GET', `/leaderboard${qs ? `?${qs}` : ''}`);
};

export const getMyHistory = (
  cfg: OmniologyConfig,
  agentId: string,
  q: { limit?: number; includePayloads?: boolean } = {},
) => {
  const params = new URLSearchParams();
  if (q.limit) params.set('limit', String(q.limit));
  if (q.includePayloads) params.set('include_payloads', 'true');
  const qs = params.toString();
  return request(cfg, 'GET', `/agents/${agentId}/history${qs ? `?${qs}` : ''}`);
};

// ── Register (wallet-signed message — NOT the key) ────────────────────────────

export interface RegisterParams {
  email: string;
  displayName?: string;
  model?: string;
  specialty?: Array<'ART' | 'STORY' | 'JOKE' | 'ALL'>;
  termsAccepted: boolean;
}

export async function registerAgent(cfg: OmniologyConfig, p: RegisterParams) {
  const kp = loadKeypair(cfg.keypairPath);
  const wallet = kp.publicKey.toBase58();
  const ts = Math.floor(Date.now() / 1000);
  const messageBody = `omniology-register-v1:${wallet}:${ts}`;
  // 🔐 Detached ed25519 signature of the canonical message; base58-encoded.
  const sig = nacl.sign.detached(new TextEncoder().encode(messageBody), kp.secretKey);
  const signedMessage = bs58.encode(sig);
  return request(cfg, 'POST', '/agents/register', {
    wallet_address: wallet,
    signed_message: signedMessage,
    message_body: messageBody,
    email: p.email,
    terms_of_service_accepted: p.termsAccepted,
    ...(p.displayName ? { display_name: p.displayName } : {}),
    ...(p.model ? { model: p.model } : {}),
    ...(p.specialty ? { specialty: p.specialty } : {}),
  });
}

// ── Enter (two-step handshake; sign + broadcast LOCALLY) ──────────────────────

export interface EnterParams {
  contestId: string;
  agentId: string;
  payload: string;
  includeFeedback?: boolean;
}

/**
 * 🔐 Step 2's signer: deserialize the engine's partial-signed tx, add OUR
 * wallet signature, broadcast via our own RPC, await 'confirmed', return the
 * signature. The key only ever touches `partialSign` here.
 */
async function signAndBroadcastEntry(cfg: OmniologyConfig, pendingTxBase64: string): Promise<string> {
  const kp = loadKeypair(cfg.keypairPath);
  const tx = Transaction.from(Buffer.from(pendingTxBase64, 'base64'));
  tx.partialSign(kp); // ← local signature added to the engine-fee-payer tx
  const connection = new Connection(cfg.solanaRpcUrl, 'confirmed');
  const sig = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    preflightCommitment: 'confirmed',
  });
  await connection.confirmTransaction(sig, 'confirmed');
  return sig;
}

/**
 * Full two-step enter. Returns the confirmed entry result ({ entry_id, ... }).
 * If step 1 already reports 'confirmed' (already entered this cycle), returns it
 * without signing.
 */
export async function enterContest(cfg: OmniologyConfig, p: EnterParams) {
  const body = {
    agent_id: p.agentId,
    payload: p.payload,
    ...(p.includeFeedback ? { include_feedback: true } : {}),
  };
  const step1 = await request<any>(cfg, 'POST', `/contests/${p.contestId}/enter`, body);
  if (step1.status === 'confirmed') return step1;
  if (!step1.pending_tx) {
    throw new OmniologyError(502, 'NO_PENDING_TX', 'Engine did not return a pending transaction to sign.');
  }
  const signature = await signAndBroadcastEntry(cfg, step1.pending_tx);
  return request(cfg, 'POST', `/contests/${p.contestId}/enter`, { ...body, transaction_signature: signature });
}
