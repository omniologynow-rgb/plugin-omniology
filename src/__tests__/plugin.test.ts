import { describe, expect, it } from 'bun:test';
import { omniologyPlugin, omniologyActions, liveContestsProvider } from '../index';
import { createMockRuntime } from './test-utils';

const ACTION_NAMES = [
  'REGISTER_AGENT',
  'CHECK_READINESS',
  'LIST_ACTIVE_CONTESTS',
  'SUBMIT_ENTRY',
  'CHECK_PAYOUT',
  'GET_CONTEST_RULES',
  'GET_LEADERBOARD',
  'GET_MY_HISTORY',
];

describe('plugin shape', () => {
  it('has the expected name + description', () => {
    expect(omniologyPlugin.name).toBe('@omniology/plugin-omniology');
    expect(typeof omniologyPlugin.description).toBe('string');
  });

  it('registers all 8 actions (5 core + 3 read)', () => {
    expect(omniologyPlugin.actions).toBeDefined();
    const names = (omniologyPlugin.actions ?? []).map((a) => a.name).sort();
    expect(names).toEqual([...ACTION_NAMES].sort());
    expect(omniologyActions.length).toBe(8);
  });

  it('registers the LIVE_CONTESTS provider', () => {
    expect((omniologyPlugin.providers ?? []).map((p) => p.name)).toContain('LIVE_CONTESTS');
    expect(liveContestsProvider.name).toBe('LIVE_CONTESTS');
  });

  it('every action has name, description, validate, handler, examples', () => {
    for (const a of omniologyActions) {
      expect(typeof a.name).toBe('string');
      expect(typeof a.description).toBe('string');
      expect(typeof a.validate).toBe('function');
      expect(typeof a.handler).toBe('function');
      expect(Array.isArray(a.examples)).toBe(true);
    }
  });

  it('init() runs without throwing and validates config', async () => {
    const runtime = createMockRuntime() as unknown as Parameters<NonNullable<typeof omniologyPlugin.init>>[1];
    await expect(
      omniologyPlugin.init?.({ OMNIOLOGY_API_BASE: 'https://example.com/v1' }, runtime),
    ).resolves.toBeUndefined();
  });
});

describe('action validate() gating (no network)', () => {
  const find = (n: string) => omniologyActions.find((a) => a.name === n)!;
  const rt = (settings: Record<string, string>) =>
    ({ getSetting: (k: string) => settings[k] }) as unknown as Parameters<typeof find>[0] extends never ? any : any;

  const mockMsg = {} as any;

  it('LIST_ACTIVE_CONTESTS is always eligible', async () => {
    expect(await find('LIST_ACTIVE_CONTESTS').validate(rt({}), mockMsg, undefined)).toBe(true);
  });

  it('SUBMIT_ENTRY requires agent_id AND keypair', async () => {
    expect(await find('SUBMIT_ENTRY').validate(rt({}), mockMsg, undefined)).toBe(false);
    expect(
      await find('SUBMIT_ENTRY').validate(
        rt({ OMNIOLOGY_AGENT_ID: 'a', OMNIOLOGY_KEYPAIR_PATH: '/k.json' }),
        mockMsg,
        undefined,
      ),
    ).toBe(true);
  });

  it('CHECK_READINESS requires agent_id', async () => {
    expect(await find('CHECK_READINESS').validate(rt({}), mockMsg, undefined)).toBe(false);
    expect(await find('CHECK_READINESS').validate(rt({ OMNIOLOGY_AGENT_ID: 'a' }), mockMsg, undefined)).toBe(true);
  });

  it('REGISTER_AGENT requires a keypair path', async () => {
    expect(await find('REGISTER_AGENT').validate(rt({}), mockMsg, undefined)).toBe(false);
    expect(await find('REGISTER_AGENT').validate(rt({ OMNIOLOGY_KEYPAIR_PATH: '/k.json' }), mockMsg, undefined)).toBe(true);
  });

  it('CHECK_PAYOUT is always eligible (handler enforces entry_id)', async () => {
    expect(await find('CHECK_PAYOUT').validate(rt({}), mockMsg, undefined)).toBe(true);
  });

  it('GET_CONTEST_RULES + GET_LEADERBOARD are always eligible', async () => {
    expect(await find('GET_CONTEST_RULES').validate(rt({}), mockMsg, undefined)).toBe(true);
    expect(await find('GET_LEADERBOARD').validate(rt({}), mockMsg, undefined)).toBe(true);
  });

  it('GET_MY_HISTORY requires agent_id', async () => {
    expect(await find('GET_MY_HISTORY').validate(rt({}), mockMsg, undefined)).toBe(false);
    expect(await find('GET_MY_HISTORY').validate(rt({ OMNIOLOGY_AGENT_ID: 'a' }), mockMsg, undefined)).toBe(true);
  });
});
