/**
 * integration.test.ts — READ-ONLY live checks against the prod Omniology engine.
 *
 * Gated: only runs when INTEGRATION=true (so normal `bun test` / CI never hits
 * the network). NEVER calls a state-changing endpoint — no register, no enter,
 * no signing. Just the public reads.
 *
 *   INTEGRATION=true bun test src/__tests__/integration.test.ts
 */
import { describe, expect, it } from 'bun:test';
import {
  listActiveContests,
  getLeaderboard,
  getJudgeRubric,
  getWinners,
  getContestRules,
} from '../omniology/client';

const RUN = process.env.INTEGRATION === 'true';
const D = RUN ? describe : describe.skip;
const T = 20000; // network timeout

const cfg = {
  apiBase: process.env.OMNIOLOGY_API_BASE || 'https://omniology-engine.fly.dev/v1',
  solanaRpcUrl: 'https://api.mainnet-beta.solana.com',
};

D('live read-only endpoints', () => {
  it('LIST_ACTIVE_CONTESTS returns contests or next_batch_at', async () => {
    const r: any = await listActiveContests(cfg);
    expect(r).toBeDefined();
    expect(Array.isArray(r.contests) || r.next_batch_at != null).toBe(true);
  }, T);

  it('GET_LEADERBOARD returns data', async () => {
    const r: any = await getLeaderboard(cfg, { limit: 5 });
    expect(r).toBeDefined();
  }, T);

  it('GET_JUDGE_RUBRIC_EXPLAINER returns dimensions and leaks NO weights', async () => {
    const r: any = await getJudgeRubric(cfg);
    expect(r.rubric_explainer).toBeDefined();
    expect(Object.keys(r.dimensions ?? {})).toContain('originality');
    const s = JSON.stringify(r).toLowerCase();
    for (const forbidden of ['weight', 'ensemble', 'threshold', 'temperature', 'model_name']) {
      expect(s.includes(forbidden)).toBe(false);
    }
  }, T);

  it('GET_WINNING_ENTRIES returns public fields only (no per-axis breakdown)', async () => {
    const r: any = await getWinners(cfg, { limit: 3 });
    const entries = r.entries ?? r ?? [];
    expect(Array.isArray(entries)).toBe(true);
    const s = JSON.stringify(r).toLowerCase();
    for (const forbidden of ['score_originality', 'score_theme_alignment', 'score_execution', 'score_surprise']) {
      expect(s.includes(forbidden)).toBe(false);
    }
  }, T);

  it('GET_CONTEST_RULES resolves for a real contest (when one is available)', async () => {
    const list: any = await listActiveContests(cfg);
    const id = list?.contests?.[0]?.contest_id;
    if (!id) {
      // No open contest right now — nothing to assert; the other reads cover the path.
      expect(true).toBe(true);
      return;
    }
    const rules: any = await getContestRules(cfg, id);
    expect(rules).toBeDefined();
    expect(rules.track ?? rules.theme ?? rules.theme_text).toBeDefined();
  }, T);
});
