/**
 * signing.test.ts — unit tests for the LOCAL-signing write paths, with NO real
 * key, NO network, NO chain. Uses a generated throwaway keypair + mocked fetch +
 * mocked Connection. Verifies:
 *   - SUBMIT_ENTRY: two-step handshake, partialSign invoked, broadcast built,
 *     step 2 carries the broadcast signature.
 *   - REGISTER_AGENT: correct body + a cryptographically valid detached signature.
 */
import { describe, expect, it, beforeEach, afterEach, afterAll, spyOn } from 'bun:test';
import { Keypair, Transaction, Connection, SystemProgram, PublicKey } from '@solana/web3.js';
import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { enterContest, registerAgent } from '../omniology/client';

// Generated throwaway keypair (NOT a real wallet).
const kp = Keypair.generate();
const KEYPATH = join(tmpdir(), `omni-test-${Date.now()}-${Math.floor(performance.now())}.json`);
writeFileSync(KEYPATH, JSON.stringify(Array.from(kp.secretKey)));

const cfg = {
  apiBase: 'http://test.local/v1',
  agentId: 'agent-1',
  keypairPath: KEYPATH,
  solanaRpcUrl: 'http://rpc.local',
};

// A deserializable pending tx where our test key is the fee payer, so
// Transaction.partialSign(kp) succeeds the way the real engine tx would.
function buildPendingTxBase64(): string {
  const tx = new Transaction({
    recentBlockhash: PublicKey.default.toBase58(), // 32 zero-bytes — valid base58 blockhash for the test
    feePayer: kp.publicKey,
  });
  tx.add(SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: kp.publicKey, lamports: 1 }));
  return tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64');
}

const originalFetch = globalThis.fetch;
let fetchCalls: Array<{ url: string; body: any }> = [];
let sendSpy: ReturnType<typeof spyOn>;
let confirmSpy: ReturnType<typeof spyOn>;
let partialSignSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  fetchCalls = [];
  const pendingTx = buildPendingTxBase64();
  globalThis.fetch = (async (url: any, init: any) => {
    const body = init?.body ? JSON.parse(init.body) : undefined;
    fetchCalls.push({ url: String(url), body });
    if (String(url).includes('/agents/register')) {
      return new Response(JSON.stringify({ agent_id: 'new-agent', wallet_verified: true }), { status: 201 });
    }
    if (body?.transaction_signature) {
      return new Response(JSON.stringify({ status: 'confirmed', entry_id: 'e1' }), { status: 200 });
    }
    return new Response(JSON.stringify({ status: 'pending_agent_signature', pending_tx: pendingTx }), { status: 200 });
  }) as any;

  sendSpy = spyOn(Connection.prototype, 'sendRawTransaction').mockImplementation(async () => 'SIG_BROADCAST');
  confirmSpy = spyOn(Connection.prototype, 'confirmTransaction').mockImplementation(async () => ({}) as any);
  partialSignSpy = spyOn(Transaction.prototype, 'partialSign');
});

afterEach(() => {
  sendSpy.mockRestore();
  confirmSpy.mockRestore();
  partialSignSpy.mockRestore();
  globalThis.fetch = originalFetch;
});

afterAll(() => {
  try { rmSync(KEYPATH); } catch { /* ignore */ }
});

describe('SUBMIT_ENTRY local-signing flow', () => {
  it('runs the two-step handshake, signs locally, broadcasts, returns entry_id', async () => {
    const result: any = await enterContest(cfg, { contestId: 'c1', agentId: 'agent-1', payload: 'hello' });

    expect(result.entry_id).toBe('e1');
    expect(fetchCalls.length).toBe(2); // step 1 + step 2
    expect(partialSignSpy).toHaveBeenCalled(); // local signature added
    expect(sendSpy).toHaveBeenCalled(); // broadcast built + sent
    // step 2 carries the broadcast signature back to the engine
    expect(fetchCalls[1]?.body?.transaction_signature).toBe('SIG_BROADCAST');
    expect(fetchCalls[1]?.body?.agent_id).toBe('agent-1');
  });

  it('passes include_feedback through when requested', async () => {
    await enterContest(cfg, { contestId: 'c1', agentId: 'agent-1', payload: 'x', includeFeedback: true });
    expect(fetchCalls[0]?.body?.include_feedback).toBe(true);
  });

  it('skips signing when step 1 already reports confirmed', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ status: 'confirmed', entry_id: 'already' }), { status: 200 })) as any;
    const r: any = await enterContest(cfg, { contestId: 'c1', agentId: 'agent-1', payload: 'x' });
    expect(r.entry_id).toBe('already');
    expect(partialSignSpy).not.toHaveBeenCalled();
    expect(sendSpy).not.toHaveBeenCalled();
  });
});

describe('REGISTER_AGENT message signing', () => {
  it('sends the right body with a cryptographically valid detached signature', async () => {
    await registerAgent(cfg, { email: 'me@example.com', termsAccepted: true, displayName: 'Tester' });

    const reg = fetchCalls.find((c) => c.url.includes('/agents/register'));
    expect(reg).toBeDefined();
    const b = reg!.body;
    expect(b.wallet_address).toBe(kp.publicKey.toBase58());
    expect(b.email).toBe('me@example.com');
    expect(b.terms_of_service_accepted).toBe(true);
    expect(b.display_name).toBe('Tester');
    expect(typeof b.message_body).toBe('string');
    expect(b.message_body.startsWith(`omniology-register-v1:${kp.publicKey.toBase58()}:`)).toBe(true);

    // The signature must verify against the message_body + the wallet pubkey.
    const ok = nacl.sign.detached.verify(
      new TextEncoder().encode(b.message_body),
      bs58.decode(b.signed_message),
      kp.publicKey.toBytes(),
    );
    expect(ok).toBe(true);
  });
});
