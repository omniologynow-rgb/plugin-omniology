/**
 * provider.ts — LIVE_CONTESTS provider.
 *
 * Surfaces the currently-open Omniology contests into the agent's context on
 * every reasoning turn, so the agent knows what it can enter without being told.
 * Read-only (GET /contests/active); fail-soft (returns empty context on error).
 *
 * Caching: providers can fire on every message. We cache the formatted result
 * for a short TTL (OMNIOLOGY_PROVIDER_TTL_MS, default 30s) so a chatty agent
 * doesn't hammer the engine — contests change on an ~88s cadence, so 30s is
 * fresh enough.
 */

import type { IAgentRuntime, Memory, Provider, ProviderResult, State } from '@elizaos/core';
import { getConfig } from './omniology/config.js';
import { listActiveContests } from './omniology/client.js';

const EMPTY: ProviderResult = { text: '', data: {}, values: {} };

function ttlMs(): number {
  const n = parseInt(process.env['OMNIOLOGY_PROVIDER_TTL_MS'] ?? '30000', 10);
  return Number.isFinite(n) && n >= 0 ? n : 30000;
}

// Module-level cache (persists across calls in the long-lived agent process).
let cache: { at: number; result: ProviderResult } | null = null;

function formatResult(r: any): ProviderResult {
  const contests = (r?.contests ?? []) as any[];
  if (!contests.length) {
    return {
      text: r?.next_batch_at
        ? `No Omniology contests open; next batch at ${r.next_batch_at}.`
        : 'No Omniology contests open right now.',
      data: { contests: [], next_batch_at: r?.next_batch_at ?? null },
      values: { omniology_open_contests: 0 },
    };
  }
  const lines = contests
    .slice(0, 8)
    .map(
      (c) =>
        `- ${c.track} [${c.contest_id}]: "${String(c.theme).slice(0, 60)}" ` +
        `(${c.time_remaining_seconds ?? '?'}s left, ${c.current_entries ?? 0} entries)`,
    );
  return {
    text: `Open Omniology contests (${contests.length}):\n${lines.join('\n')}`,
    data: { contests, next_batch_at: r?.next_batch_at ?? null },
    values: { omniology_open_contests: contests.length },
  };
}

export const liveContestsProvider: Provider = {
  name: 'LIVE_CONTESTS',
  description: 'Currently-open Omniology contests (track, theme, time remaining).',
  dynamic: true,
  get: async (runtime: IAgentRuntime, _m: Memory, _s: State): Promise<ProviderResult> => {
    const now = Date.now();
    if (cache && now - cache.at < ttlMs()) return cache.result;
    try {
      const r = await listActiveContests(getConfig(runtime));
      const result = formatResult(r);
      cache = { at: now, result };
      return result;
    } catch {
      // Fail-soft: never break the agent's turn over a transient API blip.
      // Serve a slightly-stale cache if we have one; otherwise empty context.
      return cache?.result ?? EMPTY;
    }
  },
};

/** Test-only: reset the module cache between unit tests. */
export function __resetLiveContestsCache(): void {
  cache = null;
}
