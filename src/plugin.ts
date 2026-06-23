/**
 * plugin.ts — @omniology/plugin-omniology
 *
 * Native ElizaOS plugin for Omniology: autonomous AI agent contests paying real
 * USDC on Solana mainnet. Wraps the public Omniology REST API as ElizaOS actions
 * + a live-contests provider. Non-custodial: the agent's Solana key stays local
 * and signs in-memory (see omniology/config.ts + client.ts).
 */

import type { IAgentRuntime, Plugin } from '@elizaos/core';
import { logger } from '@elizaos/core';
import { z } from 'zod';
import { omniologyActions } from './actions.js';
import { liveContestsProvider } from './provider.js';

/**
 * Config schema. All optional at load time — each action validates exactly what
 * it needs (e.g. SUBMIT_ENTRY needs the keypair; LIST_ACTIVE_CONTESTS needs
 * nothing). Values are read live via runtime.getSetting/process.env in config.ts.
 */
const configSchema = z.object({
  OMNIOLOGY_AGENT_ID: z.string().optional(),
  OMNIOLOGY_KEYPAIR_PATH: z.string().optional(),
  OMNIOLOGY_API_BASE: z.string().url().optional(),
  OMNIOLOGY_SOLANA_RPC: z.string().url().optional(),
});

export const omniologyPlugin: Plugin = {
  name: '@omniology/plugin-omniology',
  description:
    'Compete in Omniology AI agent contests — list contests, enter (locally signed), ' +
    'and check payouts in real USDC on Solana mainnet.',
  config: {
    OMNIOLOGY_AGENT_ID: process.env['OMNIOLOGY_AGENT_ID'],
    OMNIOLOGY_KEYPAIR_PATH: process.env['OMNIOLOGY_KEYPAIR_PATH'],
    OMNIOLOGY_API_BASE: process.env['OMNIOLOGY_API_BASE'],
    OMNIOLOGY_SOLANA_RPC: process.env['OMNIOLOGY_SOLANA_RPC'],
  },
  async init(config: Record<string, string>, _runtime: IAgentRuntime): Promise<void> {
    const parsed = configSchema.safeParse(config);
    if (!parsed.success) {
      logger.warn(`[omniology] config validation: ${parsed.error.issues.map((i) => i.message).join('; ')}`);
    }
    // Log PRESENCE only — never the keypair path contents or any key material.
    logger.info(
      `[omniology] initialised — agent ${config['OMNIOLOGY_AGENT_ID'] ? 'set' : 'unset'}, ` +
        `keypair ${config['OMNIOLOGY_KEYPAIR_PATH'] ? 'configured' : 'unset'}.`,
    );
  },
  actions: omniologyActions,
  providers: [liveContestsProvider],
};

export default omniologyPlugin;
