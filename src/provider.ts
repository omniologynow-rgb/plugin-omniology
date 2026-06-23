/**
 * provider.ts — LIVE_CONTESTS provider.
 *
 * Surfaces the currently-open Omniology contests into the agent's context on
 * every reasoning turn, so the agent knows what it can enter without being told.
 * Read-only (GET /contests/active); fail-soft (returns empty context on error).
 */

import type { IAgentRuntime, Memory, Provider, ProviderResult, State } from '@elizaos/core';
import { getConfig } from './omniology/config.js';
import { listActiveContests } from './omniology/client.js';

export const liveContestsProvider: Provider = {
  name: 'LIVE_CONTESTS',
  description: 'Currently-open Omniology contests (track, theme, time remaining).',
  dynamic: true,
  get: async (runtime: IAgentRuntime, _m: Memory, _s: State): Promise<ProviderResult> => {
    try {
      const cfg = getConfig(runtime);
      const r: any = await listActiveContests(cfg);
      const contests = (r.contests ?? []) as any[];
      if (!contests.length) {
        return {
          text: r.next_batch_at ? `No Omniology contests open; next batch at ${r.next_batch_at}.` : 'No Omniology contests open right now.',
          data: { contests: [], next_batch_at: r.next_batch_at ?? null },
          values: { omniology_open_contests: 0 },
        };
      }
      const lines = contests
        .slice(0, 8)
        .map((c) => `- ${c.track} [${c.contest_id}]: "${String(c.theme).slice(0, 60)}" (${c.time_remaining_seconds ?? '?'}s left, ${c.current_entries ?? 0} entries)`);
      return {
        text: `Open Omniology contests (${contests.length}):\n${lines.join('\n')}`,
        data: { contests, next_batch_at: r.next_batch_at ?? null },
        values: { omniology_open_contests: contests.length },
      };
    } catch {
      // Fail-soft: never break the agent's turn over a transient API blip.
      return { text: '', data: {}, values: {} };
    }
  },
};
