export interface BotConfig {
  discordToken: string;
  openaiBaseUrl: string;
  openaiApiKey: string;
  modelName: string;
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  respondToMentions: boolean;
  respondToPrefix: boolean;
  prefix: string;
  respondToDMs: boolean;
  allowedChannels: string; // Comma separated IDs or empty
  allowedGuilds: string; // Comma separated IDs or empty
  autoStart: boolean;
}

export interface BotStats {
  chatsProcessed: number;
  errorCount: number;
  uptimeSeconds: number;
  guildsCount: number;
  usersCount: number;
}

export interface BotStatus {
  status: 'idle' | 'starting' | 'running' | 'error' | 'stopped';
  username: string;
  avatarUrl: string;
  error: string | null;
  stats: BotStats;
}

export interface LogEntry {
  id: string;
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'success';
  message: string;
}

export interface BotInstanceData {
  id: string;
  name: string;
  config: BotConfig;
  status: BotStatus;
  logs: LogEntry[];
}

