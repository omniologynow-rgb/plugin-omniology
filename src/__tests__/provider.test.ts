/**
 * provider.test.ts — LIVE_CONTESTS provider unit tests (mocked fetch; no network).
 * Covers formatting, the TTL cache, and fail-soft behaviour.
 */
import { describe, expect, it, beforeEach, afterAll } from 'bun:test';
import { liveContestsProvider, __resetLiveContestsCache } from '../provider';

const runtime = { getSetting: (_k: string) => undefined } as any;
const msg = {} as any;
const state = {} as any;
const originalFetch = globalThis.fetch;

function mockContests(contests: any[], next_batch_at: string | null = null) {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ contests, next_batch_at }), { status: 200 })) as any;
}

beforeEach(() => {
  __resetLiveContestsCache();
  process.env.OMNIOLOGY_PROVIDER_TTL_MS = '30000';
});
afterAll(() => { globalThis.fetch = originalFetch; });

describe('LIVE_CONTESTS provider', () => {
  it('formats open contests into agent-readable context', async () => {
    mockContests([
      { track: 'JOKE', contest_id: 'c1', theme: 'a unicorn doing taxes', time_remaining_seconds: 40, current_entries: 2 },
    ]);
    const r = await liveContestsProvider.get(runtime, msg, state);
    expect(r.text).toContain('Open Omniology contests (1)');
    expect(r.text).toContain('JOKE [c1]');
    expect(r.values?.omniology_open_contests).toBe(1);
  });

  it('reports the empty case with next_batch_at', async () => {
    mockContests([], '2026-06-23T12:00:00Z');
    const r = await liveContestsProvider.get(runtime, msg, state);
    expect(r.text).toContain('next batch at');
    expect(r.values?.omniology_open_contests).toBe(0);
  });

  it('caches within the TTL (second call does not re-fetch)', async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return new Response(JSON.stringify({ contests: [{ track: 'ART', contest_id: 'a1', theme: 't' }] }), { status: 200 });
    }) as any;
    await liveContestsProvider.get(runtime, msg, state);
    await liveContestsProvider.get(runtime, msg, state);
    expect(calls).toBe(1); // cached
  });

  it('fail-soft: returns empty context when the API errors and no cache exists', async () => {
    __resetLiveContestsCache();
    globalThis.fetch = (async () => { throw new Error('network down'); }) as any;
    const r = await liveContestsProvider.get(runtime, msg, state);
    expect(r.text).toBe('');
  });
});
