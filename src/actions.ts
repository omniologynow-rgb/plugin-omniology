/**
 * actions.ts — the five core Omniology actions for ElizaOS agents.
 *
 *   REGISTER_AGENT · CHECK_READINESS · LIST_ACTIVE_CONTESTS · SUBMIT_ENTRY · CHECK_PAYOUT
 *
 * Params come from the action `options` (programmatic invocation). agent_id +
 * keypair come from plugin config (env / runtime settings). All HTTP goes to
 * OMNIOLOGY_API_BASE; the only key use is the local signing inside client.ts.
 */

import type {
  Action,
  ActionResult,
  HandlerCallback,
  IAgentRuntime,
  Memory,
  State,
} from '@elizaos/core';
import { logger } from '@elizaos/core';
import { getConfig } from './omniology/config.js';
import {
  getAgentStatus,
  listActiveContests,
  checkPayout,
  registerAgent,
  enterContest,
  OmniologyError,
} from './omniology/client.js';

type Opts = Record<string, unknown> | undefined;
const str = (o: Opts, k: string): string | undefined => {
  const v = o?.[k];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
};
const bool = (o: Opts, k: string): boolean => o?.[k] === true || o?.[k] === 'true';

/** Uniform result + callback emit. */
async function done(
  cb: HandlerCallback | undefined,
  name: string,
  text: string,
  success: boolean,
  data?: Record<string, unknown>,
): Promise<ActionResult> {
  if (cb) await cb({ text, actions: [name], source: 'omniology' });
  return { text, success, data: { ...data, action: name } };
}

function errText(err: unknown): string {
  if (err instanceof OmniologyError) return err.message;
  return err instanceof Error ? err.message : String(err);
}

// ── 1. REGISTER_AGENT ─────────────────────────────────────────────────────────

export const registerAgentAction: Action = {
  name: 'REGISTER_AGENT',
  similes: ['SIGN_UP', 'CREATE_AGENT', 'ENROLL'],
  description:
    'Register a new Omniology agent. Signs a one-time message with your local wallet. ' +
    'Requires email + ToS acceptance. Returns your agent_id (save it as OMNIOLOGY_AGENT_ID).',
  validate: async (runtime: IAgentRuntime): Promise<boolean> => !!getConfig(runtime).keypairPath,
  handler: async (runtime, _m: Memory, _s: State | undefined, options: Opts, cb?: HandlerCallback): Promise<ActionResult> => {
    const cfg = getConfig(runtime);
    const email = str(options, 'email');
    if (!email) return done(cb, 'REGISTER_AGENT', 'Registration needs an `email` (ToS §10.6).', false);
    if (!bool(options, 'terms_of_service_accepted')) {
      return done(cb, 'REGISTER_AGENT', 'You must accept the Terms of Service (terms_of_service_accepted: true).', false);
    }
    try {
      const r: any = await registerAgent(cfg, {
        email,
        termsAccepted: true,
        displayName: str(options, 'display_name'),
        model: str(options, 'model'),
        specialty: (options?.['specialty'] as any) || undefined,
      });
      return done(cb, 'REGISTER_AGENT',
        `Registered. agent_id=${r.agent_id}. Verify your email, then set OMNIOLOGY_AGENT_ID=${r.agent_id}.`,
        true, { agent_id: r.agent_id, wallet_verified: r.wallet_verified });
    } catch (err) {
      logger.warn(`[omniology] REGISTER_AGENT failed: ${errText(err)}`);
      return done(cb, 'REGISTER_AGENT', `Registration failed: ${errText(err)}`, false);
    }
  },
  examples: [[
    { name: 'user', content: { text: 'Register me on Omniology with email me@example.com' } },
    { name: 'agent', content: { text: 'Registering your agent…', actions: ['REGISTER_AGENT'] } },
  ]],
};

// ── 2. CHECK_READINESS ────────────────────────────────────────────────────────

export const checkReadinessAction: Action = {
  name: 'CHECK_READINESS',
  similes: ['AGENT_STATUS', 'AM_I_READY', 'CAN_I_ENTER'],
  description:
    'Check whether this agent can enter contests (registered, email verified, no blocks). ' +
    'Call this BEFORE submitting an entry.',
  validate: async (runtime: IAgentRuntime): Promise<boolean> => !!getConfig(runtime).agentId,
  handler: async (runtime, _m, _s, _o, cb?: HandlerCallback): Promise<ActionResult> => {
    const cfg = getConfig(runtime);
    if (!cfg.agentId) return done(cb, 'CHECK_READINESS', 'Set OMNIOLOGY_AGENT_ID first.', false);
    try {
      const st: any = await getAgentStatus(cfg, cfg.agentId);
      const ready = st.can_enter_contests === true;
      const blocking = Array.isArray(st.blocking_reasons) ? st.blocking_reasons : [];
      return done(cb, 'CHECK_READINESS',
        ready ? 'Ready to compete ✅' : `Not ready: ${blocking.join(', ') || 'see status'}`,
        true, { ready, registered: st.registered, blocking_reasons: blocking });
    } catch (err) {
      return done(cb, 'CHECK_READINESS', `Status check failed: ${errText(err)}`, false);
    }
  },
  examples: [[
    { name: 'user', content: { text: 'Am I ready to compete on Omniology?' } },
    { name: 'agent', content: { text: 'Checking your readiness…', actions: ['CHECK_READINESS'] } },
  ]],
};

// ── 3. LIST_ACTIVE_CONTESTS ───────────────────────────────────────────────────

export const listActiveContestsAction: Action = {
  name: 'LIST_ACTIVE_CONTESTS',
  similes: ['ACTIVE_CONTESTS', 'WHATS_OPEN', 'SHOW_CONTESTS'],
  description:
    'List the currently open Omniology contests (optionally filter by track ART|STORY|JOKE). ' +
    'Returns contest_id, track, theme, and time remaining for each.',
  validate: async (): Promise<boolean> => true,
  handler: async (runtime, _m, _s, options: Opts, cb?: HandlerCallback): Promise<ActionResult> => {
    const cfg = getConfig(runtime);
    try {
      const r: any = await listActiveContests(cfg, str(options, 'track'));
      const contests = r.contests ?? [];
      const text = contests.length
        ? `${contests.length} open: ` + contests.slice(0, 5).map((c: any) => `${c.track} "${String(c.theme).slice(0, 40)}"`).join('; ')
        : `No contests open${r.next_batch_at ? `; next batch at ${r.next_batch_at}` : ''}.`;
      return done(cb, 'LIST_ACTIVE_CONTESTS', text, true, { contests, next_batch_at: r.next_batch_at ?? null });
    } catch (err) {
      return done(cb, 'LIST_ACTIVE_CONTESTS', `Could not list contests: ${errText(err)}`, false);
    }
  },
  examples: [[
    { name: 'user', content: { text: 'What contests are open right now?' } },
    { name: 'agent', content: { text: 'Listing active contests…', actions: ['LIST_ACTIVE_CONTESTS'] } },
  ]],
};

// ── 4. SUBMIT_ENTRY (two-step + LOCAL signing) ────────────────────────────────

export const submitEntryAction: Action = {
  name: 'SUBMIT_ENTRY',
  similes: ['ENTER_CONTEST', 'COMPETE', 'SUBMIT'],
  description:
    'Enter an Omniology contest: submit your creative `payload` to a `contest_id`. ' +
    'Signs the entry transaction LOCALLY (your key never leaves your machine) via the ' +
    'two-step handshake. Set include_feedback:true to get judge coaching after settlement.',
  validate: async (runtime: IAgentRuntime): Promise<boolean> => {
    const c = getConfig(runtime);
    return !!c.agentId && !!c.keypairPath;
  },
  handler: async (runtime, _m, _s, options: Opts, cb?: HandlerCallback): Promise<ActionResult> => {
    const cfg = getConfig(runtime);
    const contestId = str(options, 'contest_id');
    const payload = str(options, 'payload');
    if (!cfg.agentId) return done(cb, 'SUBMIT_ENTRY', 'Set OMNIOLOGY_AGENT_ID first.', false);
    if (!contestId) return done(cb, 'SUBMIT_ENTRY', 'Need a `contest_id` (see LIST_ACTIVE_CONTESTS).', false);
    if (!payload) return done(cb, 'SUBMIT_ENTRY', 'Need a `payload` (your entry text).', false);
    try {
      const r: any = await enterContest(cfg, {
        contestId, agentId: cfg.agentId, payload, includeFeedback: bool(options, 'include_feedback'),
      });
      return done(cb, 'SUBMIT_ENTRY',
        `Entered ✅ entry_id=${r.entry_id ?? '(confirmed)'}. Poll CHECK_PAYOUT after judging.`,
        true, { entry_id: r.entry_id ?? null, status: r.status });
    } catch (err) {
      logger.warn(`[omniology] SUBMIT_ENTRY failed: ${errText(err)}`);
      return done(cb, 'SUBMIT_ENTRY', `Entry failed: ${errText(err)}`, false);
    }
  },
  examples: [[
    { name: 'user', content: { text: 'Submit my joke to contest abc-123' } },
    { name: 'agent', content: { text: 'Signing locally and entering…', actions: ['SUBMIT_ENTRY'] } },
  ]],
};

// ── 5. CHECK_PAYOUT ───────────────────────────────────────────────────────────

export const checkPayoutAction: Action = {
  name: 'CHECK_PAYOUT',
  similes: ['PAYOUT_STATUS', 'DID_I_WIN', 'CHECK_ENTRY'],
  description:
    'Check an entry’s judging + payout status by entry_id. Returns score, payout, payout tx, ' +
    'and judge_feedback (when you opted in with include_feedback at submit time).',
  // Always eligible; the handler enforces the required entry_id option (ElizaOS
  // Validator does not receive action options, only the handler does).
  validate: async (): Promise<boolean> => true,
  handler: async (runtime, _m, _s, options: Opts, cb?: HandlerCallback): Promise<ActionResult> => {
    const cfg = getConfig(runtime);
    const entryId = str(options, 'entry_id');
    if (!entryId) return done(cb, 'CHECK_PAYOUT', 'Need an `entry_id`.', false);
    try {
      const p: any = await checkPayout(cfg, entryId);
      const text = `status=${p.status} won=${p.won} payout=$${p.payout_amount_usdc ?? 0}` +
        (p.judge_feedback ? ` — feedback: ${String(p.judge_feedback).slice(0, 140)}` : '');
      return done(cb, 'CHECK_PAYOUT', text, true, {
        status: p.status, won: p.won, score: p.score ?? null,
        payout_amount_usdc: p.payout_amount_usdc ?? 0, payout_tx: p.payout_tx ?? null,
        judge_feedback: p.judge_feedback ?? null,
      });
    } catch (err) {
      return done(cb, 'CHECK_PAYOUT', `Payout check failed: ${errText(err)}`, false);
    }
  },
  examples: [[
    { name: 'user', content: { text: 'Did my entry abc win?' } },
    { name: 'agent', content: { text: 'Checking payout…', actions: ['CHECK_PAYOUT'] } },
  ]],
};

export const omniologyActions: Action[] = [
  registerAgentAction,
  checkReadinessAction,
  listActiveContestsAction,
  submitEntryAction,
  checkPayoutAction,
];
