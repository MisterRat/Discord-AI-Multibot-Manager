import { BotConfig, PublicBotConfig } from './types';

export const DEFAULT_CONFIG: BotConfig = {
  discordToken: '',
  openaiBaseUrl: 'https://api.openai.com/v1',
  openaiApiKey: '',
  modelName: 'gpt-4o-mini',
  systemPrompt: 'You are a helpful and friendly Discord AI assistant.',
  temperature: 0.7,
  maxTokens: 512,
  respondToMentions: true,
  respondToPrefix: false,
  prefix: '!',
  respondToDMs: true,
  allowedChannels: '',
  allowedGuilds: '',
  autoStart: true,
  userCooldownSeconds: 5,
};

const SECRET_KEYS = ['discordToken', 'openaiApiKey'] as const;

const STRING_KEYS = ['openaiBaseUrl', 'modelName', 'systemPrompt', 'prefix', 'allowedChannels', 'allowedGuilds'] as const;
const BOOL_KEYS = ['respondToMentions', 'respondToPrefix', 'respondToDMs', 'autoStart'] as const;
const NUMBER_KEYS = ['temperature', 'maxTokens', 'userCooldownSeconds'] as const;

/**
 * Merge an update coming from the dashboard into a stored config.
 *
 * Secrets are never sent to the browser, so the browser sends them back blank.
 * For secret fields: a non-empty string replaces the stored value, an empty
 * string or a missing field keeps it, and `null` clears it.
 * Unknown keys (like the `has*` flags) and wrongly-typed values are ignored.
 */
export function applyConfigPatch(current: BotConfig, patch: unknown): BotConfig {
  const next: BotConfig = { ...current };
  if (!patch || typeof patch !== 'object') return next;
  const p = patch as Record<string, unknown>;

  for (const key of SECRET_KEYS) {
    const v = p[key];
    if (v === null) next[key] = '';
    else if (typeof v === 'string' && v.trim()) next[key] = v.trim();
  }
  for (const key of STRING_KEYS) {
    if (typeof p[key] === 'string') next[key] = p[key] as string;
  }
  for (const key of BOOL_KEYS) {
    if (typeof p[key] === 'boolean') next[key] = p[key] as boolean;
  }
  for (const key of NUMBER_KEYS) {
    const v = typeof p[key] === 'string' && p[key] !== '' ? Number(p[key]) : p[key];
    if (typeof v === 'number' && Number.isFinite(v)) next[key] = v;
  }
  next.userCooldownSeconds = Math.max(0, Math.min(3600, next.userCooldownSeconds));
  return next;
}

/** Strip secrets before a config leaves the server. */
export function toPublicConfig(config: BotConfig): PublicBotConfig {
  return {
    ...config,
    discordToken: '',
    openaiApiKey: '',
    hasDiscordToken: !!config.discordToken,
    hasOpenaiApiKey: !!config.openaiApiKey,
  };
}
