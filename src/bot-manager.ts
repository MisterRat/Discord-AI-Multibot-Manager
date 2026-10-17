import { Client, GatewayIntentBits, ChannelType, Partials } from 'discord.js';
import OpenAI from 'openai';
import * as fs from 'fs';
import * as path from 'path';
import { BotConfig, BotStatus, LogEntry, BotStats, BotInstanceData } from './types';
import { DEFAULT_CONFIG, applyConfigPatch, toPublicConfig } from './config';
import { hashPasscode, verifyPasscodeHash, MIN_PASSCODE_LENGTH } from './auth';
import { chunkText, UserCooldown, NO_MENTIONS, REPLY_NO_MENTIONS } from './discord-utils';

// Where settings (including bot tokens and API keys) are stored. Override with
// the CONFIG_PATH environment variable, e.g. to keep it on a Docker volume.
const CONFIG_PATH = path.resolve(process.env.CONFIG_PATH || path.join(process.cwd(), 'config.json'));
const EXAMPLE_CONFIG_PATH = path.join(process.cwd(), 'config.example.json');

export class SingleBotRunner {
  public id: string;
  public name: string;
  public config: BotConfig;
  public client: Client | null = null;
  public status: BotStatus['status'] = 'idle';
  public errorMessage: string | null = null;
  public logs: LogEntry[] = [];
  public stats: BotStats = {
    chatsProcessed: 0,
    errorCount: 0,
    uptimeSeconds: 0,
    guildsCount: 0,
    usersCount: 0,
  };
  private startTime: number | null = null;
  private conversationHistory = new Map<string, Array<{ role: 'user' | 'assistant' | 'system'; content: string }>>();
  private uptimeInterval: NodeJS.Timeout | null = null;
  private cooldown = new UserCooldown();

  constructor(
    id: string,
    name: string,
    config: BotConfig,
    private onUpdate: (type: 'log' | 'status', botId: string, payload: any) => void
  ) {
    this.id = id;
    this.name = name;
    this.config = { ...config };
  }

  public getStatus(): BotStatus {
    const uptime = this.startTime ? Math.floor((Date.now() - this.startTime) / 1000) : 0;

    let guildsCount = 0;
    let usersCount = 0;
    if (this.client && this.status === 'running') {
      try {
        guildsCount = this.client.guilds.cache.size;
        this.client.guilds.cache.forEach((guild) => {
          usersCount += guild.memberCount || 0;
        });
      } catch (err) {
        // Safe fallback in case of cache resolution issues
      }
    }

    return {
      status: this.status,
      username: this.client?.user?.tag || 'Disconnected',
      avatarUrl: this.client?.user?.displayAvatarURL() || '',
      error: this.errorMessage,
      stats: {
        chatsProcessed: this.stats.chatsProcessed,
        errorCount: this.stats.errorCount,
        uptimeSeconds: uptime,
        guildsCount,
        usersCount,
      },
    };
  }

  public getLogs(): LogEntry[] {
    return this.logs;
  }

  public addLog(level: LogEntry['level'], message: string) {
    const log: LogEntry = {
      id: Math.random().toString(36).substring(2, 9),
      timestamp: new Date().toLocaleTimeString(),
      level,
      message,
    };
    this.logs.unshift(log);
    if (this.logs.length > 150) {
      this.logs.pop();
    }

    // Callback to orchestrator
    this.onUpdate('log', this.id, log);
    this.broadcastStatus();
  }

  private broadcastStatus() {
    this.onUpdate('status', this.id, this.getStatus());
  }

  public async start(): Promise<boolean> {
    if (this.status === 'running' || this.status === 'starting') {
      this.addLog('warn', 'Bot is already running or starting.');
      return false;
    }

    if (!this.config.discordToken) {
      this.status = 'error';
      this.errorMessage = 'Discord Bot Token is empty. Please configure it in the GUI.';
      this.addLog('error', 'Cannot start bot: Discord Token is missing.');
      this.broadcastStatus();
      return false;
    }

    this.status = 'starting';
    this.errorMessage = null;
    this.addLog('info', `Spinning up Discord Bot client for bot "${this.name}"...`);
    this.broadcastStatus();

    try {
      this.client = new Client({
        intents: [
          GatewayIntentBits.Guilds,
          GatewayIntentBits.GuildMessages,
          GatewayIntentBits.DirectMessages,
          GatewayIntentBits.MessageContent,
        ],
        partials: [Partials.Channel, Partials.Message],
      });

      this.registerEvents();
      await this.client.login(this.config.discordToken.trim());

      this.startTime = Date.now();
      this.status = 'running';
      this.addLog('success', `Connected as ${this.client.user?.tag}!`);

      if (this.uptimeInterval) clearInterval(this.uptimeInterval);
      this.uptimeInterval = setInterval(() => {
        this.broadcastStatus();
      }, 5000);

      this.broadcastStatus();
      return true;
    } catch (err: any) {
      this.status = 'error';
      let errorMsg = err.message || 'Unknown connection error';
      if (errorMsg.includes('An invalid token was provided')) {
        errorMsg = 'An invalid token was provided. Verify the token in the Discord Developer Portal.';
      }
      this.errorMessage = errorMsg;
      this.stats.errorCount++;
      this.addLog('error', `Discord login failed: ${err.message}`);
      this.client = null;
      this.broadcastStatus();
      return false;
    }
  }

  public async stop(): Promise<boolean> {
    if (this.status === 'idle' || this.status === 'stopped' || !this.client) {
      this.addLog('warn', 'Bot is not active.');
      this.status = 'stopped';
      this.broadcastStatus();
      return false;
    }

    this.addLog('info', 'Stopping Discord Bot client...');
    try {
      if (this.uptimeInterval) {
        clearInterval(this.uptimeInterval);
        this.uptimeInterval = null;
      }
      await this.client.destroy();
      this.client = null;
      this.status = 'stopped';
      this.startTime = null;
      this.addLog('success', 'Discord Bot client gracefully shut down.');
      this.broadcastStatus();
      return true;
    } catch (err: any) {
      this.addLog('error', `Error while stopping Discord client: ${err.message}`);
      this.status = 'error';
      this.errorMessage = err.message;
      this.broadcastStatus();
      return false;
    }
  }

  public clearHistory(channelId: string) {
    this.conversationHistory.delete(channelId);
  }

  private registerEvents() {
    if (!this.client) return;

    this.client.on('ready', () => {
      this.addLog('info', `Client ready: Registered in ${this.client?.guilds.cache.size || 0} servers.`);
      this.broadcastStatus();
    });

    this.client.on('error', (err) => {
      this.stats.errorCount++;
      this.addLog('error', `Discord client runtime error: ${err.message}`);
      this.broadcastStatus();
    });

    this.client.on('guildCreate', (guild) => {
      this.addLog('info', `Joined a new guild: "${guild.name}" (ID: ${guild.id}, Members: ${guild.memberCount})`);
      this.broadcastStatus();
    });

    this.client.on('guildDelete', (guild) => {
      this.addLog('warn', `Removed from guild: "${guild.name}" (ID: ${guild.id})`);
      this.broadcastStatus();
    });

    this.client.on('messageCreate', async (message) => {
      if (!this.client || !this.client.user) return;

      // Ignore other bots and itself
      if (message.author.bot) return;

      const isDM = message.channel.type === ChannelType.DM;
      const channelId = message.channelId;

      // Guild ID and Channel ID restrictions
      if (!isDM) {
        if (this.config.allowedGuilds) {
          const guilds = this.config.allowedGuilds.split(',').map((g) => g.trim()).filter(Boolean);
          if (guilds.length > 0 && !guilds.includes(message.guildId || '')) {
            return; // Ignore
          }
        }
        if (this.config.allowedChannels) {
          const channels = this.config.allowedChannels.split(',').map((c) => c.trim()).filter(Boolean);
          if (channels.length > 0 && !channels.includes(channelId)) {
            return; // Ignore
          }
        }
      }

      // Check reply conditions
      let shouldRespond = false;
      let textToProcess = message.content;

      if (isDM) {
        if (this.config.respondToDMs) {
          shouldRespond = true;
        }
      } else {
        const botMention = `<@${this.client.user.id}>`;
        const botNickMention = `<@!${this.client.user.id}>`;
        const mentioned = message.content.includes(botMention) || message.content.includes(botNickMention);

        if (this.config.respondToMentions && mentioned) {
          shouldRespond = true;
          textToProcess = message.content
            .replace(botMention, '')
            .replace(botNickMention, '')
            .trim();
        }

        if (!shouldRespond && this.config.respondToPrefix && this.config.prefix) {
          if (message.content.startsWith(this.config.prefix)) {
            shouldRespond = true;
            textToProcess = message.content.slice(this.config.prefix.length).trim();
          }
        }
      }

      if (!shouldRespond) return;

      // Handle simple clean trigger
      if (textToProcess.toLowerCase() === 'clear') {
        this.conversationHistory.delete(channelId);
        await message
          .reply({ content: '🧹 Conversation history has been cleared for this channel.', allowedMentions: REPLY_NO_MENTIONS })
          .catch(() => {});
        this.addLog('info', `Cleared history in Discord channel ${channelId} by user ${message.author.tag}`);
        return;
      }

      // Per-user rate limit so one person can't run up the AI bill or flood a channel.
      const userId = message.author.id;
      if (!this.cooldown.tryAcquire(userId, this.config.userCooldownSeconds ?? DEFAULT_CONFIG.userCooldownSeconds)) {
        this.addLog('warn', `Ignored message from @${message.author.username}: still on cooldown`);
        await message.react('⏳').catch(() => {});
        return;
      }

      this.addLog(
        'info',
        `Processing prompt from @${message.author.username} in ${
          isDM ? 'DMs' : 'channel #' + ((message.channel as any).name || channelId)
        }`
      );

      let typingInterval: NodeJS.Timeout | null = null;
      try {
        await message.channel.sendTyping();
        typingInterval = setInterval(() => {
          message.channel.sendTyping().catch(() => {});
        }, 5000);
      } catch (err) {
        // safe ignore
      }

      if (!this.conversationHistory.has(channelId)) {
        this.conversationHistory.set(channelId, []);
      }
      const history = this.conversationHistory.get(channelId)!;
      const userTurn = { role: 'user' as const, content: textToProcess };
      history.push(userTurn);
      if (history.length > 15) {
        history.shift();
      }

      try {
        const aiResponse = await this.generateAIResponse(history);

        history.push({ role: 'assistant', content: aiResponse });
        if (history.length > 15) {
          history.shift();
        }

        if (typingInterval) clearInterval(typingInterval);
        typingInterval = null;

        // AI output must never be able to ping @everyone, @here, roles or users.
        const chunks = chunkText(aiResponse, 1950);
        for (let i = 0; i < chunks.length; i++) {
          if (i === 0) {
            await message.reply({ content: chunks[i], allowedMentions: REPLY_NO_MENTIONS });
          } else {
            await message.channel.send({ content: chunks[i], allowedMentions: NO_MENTIONS });
          }
        }

        this.stats.chatsProcessed++;
        this.addLog('success', `Sent AI response to @${message.author.username}`);
      } catch (err: any) {
        // Drop the unanswered user turn so the next request doesn't carry it twice.
        const idx = history.lastIndexOf(userTurn);
        if (idx !== -1) history.splice(idx, 1);

        this.stats.errorCount++;
        this.addLog('error', `Failed to generate AI chat response: ${err.message}`);
        // Full details stay in the dashboard log; the channel gets a generic message.
        await message
          .reply({ content: '⚠️ Sorry, I ran into an error processing that. Please try again later.', allowedMentions: REPLY_NO_MENTIONS })
          .catch(() => {});
      } finally {
        if (typingInterval) clearInterval(typingInterval);
        this.cooldown.release(userId);
      }
    });
  }

  private async generateAIResponse(
    history: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>
  ): Promise<string> {
    const cleanUrl = (this.config.openaiBaseUrl || '').trim();
    const cleanKey = (this.config.openaiApiKey || '').trim();
    const cleanModel = (this.config.modelName || '').trim();

    let baseUrl = cleanUrl;
    if (baseUrl.endsWith('/')) {
      baseUrl = baseUrl.slice(0, -1);
    }
    const completionsUrl = `${baseUrl}/chat/completions`;

    const messages = [
      { role: 'system', content: this.config.systemPrompt },
      ...history,
    ];

    const makeRequest = async (includeParams: boolean) => {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (cleanKey) {
        headers['Authorization'] = `Bearer ${cleanKey}`;
      }

      const body: Record<string, any> = {
        model: cleanModel,
        messages,
        stream: false,
      };

      if (includeParams) {
        if (this.config.temperature !== undefined) {
          body.temperature = this.config.temperature;
        }
        if (this.config.maxTokens !== undefined) {
          body.max_tokens = this.config.maxTokens;
        }
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 90000); // 90 seconds timeout for bot responses

      try {
        const response = await fetch(completionsUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        return response;
      } catch (err: any) {
        clearTimeout(timeoutId);
        throw err;
      }
    };

    try {
      let response = await makeRequest(true);

      // Handle fallback if temperature/max_tokens caused a 400 Bad Request on some custom backends
      if (response.status === 400) {
        try {
          const fallbackResponse = await makeRequest(false);
          if (fallbackResponse.ok) {
            response = fallbackResponse;
          }
        } catch (_) {}
      }

      if (!response.ok) {
        const status = response.status;
        let responseText = '';
        try {
          responseText = await response.text();
        } catch (_) {}
        throw new Error(`HTTP error ${status}: ${responseText.slice(0, 200)}`);
      }

      const responseText = await response.text();
      let content = '';

      // Robust check for SSE (Server-Sent Events) stream format in case the backend forces streaming
      if (responseText.includes('data:')) {
        const lines = responseText.split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('data:')) {
            const dataStr = trimmed.slice(5).trim();
            if (dataStr === '[DONE]' || !dataStr) {
              continue;
            }
            try {
              const chunk = JSON.parse(dataStr);
              const chunkContent = chunk.choices?.[0]?.delta?.content || chunk.choices?.[0]?.message?.content || '';
              content += chunkContent;
            } catch (_) {}
          }
        }
      } else {
        try {
          const responseData = JSON.parse(responseText);
          content = responseData.choices?.[0]?.message?.content || '';
        } catch (e: any) {
          throw new Error(`Failed to parse AI response JSON: ${e.message}. Response was: "${responseText.slice(0, 200)}"`);
        }
      }

      if (!content.trim()) {
        throw new Error('AI returned an empty response.');
      }

      return content.trim();
    } catch (err: any) {
      const errorMsg = err.name === 'AbortError' ? 'Request timed out after 90 seconds' : err.message;
      throw new Error(`AI generation failed: ${errorMsg}`);
    }
  }
}

export type SetPasscodeResult = { ok: boolean; reason?: 'wrong-current' | 'too-short' };

class BotManager {
  private runners = new Map<string, SingleBotRunner>();
  // scrypt hash of the admin passcode ('' = no passcode set). Never stored in plain text.
  private adminPasscodeHash = '';
  private logSubscribers = new Set<(payload: { botId: string; log: LogEntry }) => void>();
  private statusSubscribers = new Set<(payload: { botId: string; status: BotStatus }) => void>();
  private globalSubscribers = new Set<() => void>();

  constructor() {
    this.loadConfig();
  }

  public getHasPasscode(): boolean {
    return !!this.adminPasscodeHash;
  }

  /** Checks a passcode against the stored hash. Returns false when no passcode is set. */
  public verifyPasscode(code: unknown): boolean {
    if (!this.adminPasscodeHash) return false;
    return verifyPasscodeHash(code, this.adminPasscodeHash);
  }

  /**
   * Set, change or clear (newCode = '') the admin passcode. When one is already
   * set, the current passcode must be supplied. Callers are responsible for
   * deciding who may set the *first* passcode.
   */
  public setPasscode(newCode: string, currentCode: string): SetPasscodeResult {
    if (this.adminPasscodeHash && !this.verifyPasscode(currentCode)) {
      return { ok: false, reason: 'wrong-current' };
    }
    if (newCode && newCode.length < MIN_PASSCODE_LENGTH) {
      return { ok: false, reason: 'too-short' };
    }
    this.adminPasscodeHash = newCode ? hashPasscode(newCode) : '';
    this.saveConfigDisk();
    return { ok: true };
  }

  public getBots(): SingleBotRunner[] {
    return Array.from(this.runners.values());
  }

  public getBot(id: string): SingleBotRunner | undefined {
    return this.runners.get(id);
  }

  public getBotsData(): BotInstanceData[] {
    return this.getBots().map((runner) => ({
      id: runner.id,
      name: runner.name,
      config: toPublicConfig(runner.config),
      status: runner.getStatus(),
      logs: runner.getLogs(),
    }));
  }

  public createBot(name: string, config: unknown = {}): SingleBotRunner {
    const id = 'bot_' + Math.random().toString(36).substring(2, 9);
    const newConfig = applyConfigPatch(DEFAULT_CONFIG, config);
    const runner = new SingleBotRunner(id, name, newConfig, this.handleRunnerUpdate.bind(this));
    this.runners.set(id, runner);
    this.saveConfigDisk();
    runner.addLog('success', `Bot instance "${name}" created.`);
    this.broadcastGlobal();
    return runner;
  }

  public updateBot(id: string, name: unknown, newConfig: unknown): boolean {
    const runner = this.runners.get(id);
    if (!runner) return false;

    if (typeof name === 'string' && name.trim()) runner.name = name.trim();
    runner.config = applyConfigPatch(runner.config, newConfig);
    this.saveConfigDisk();
    runner.addLog('success', `Configuration updated.`);
    this.broadcastGlobal();
    return true;
  }

  public async deleteBot(id: string): Promise<boolean> {
    const runner = this.runners.get(id);
    if (!runner) return false;

    await runner.stop();
    this.runners.delete(id);
    this.saveConfigDisk();
    this.broadcastGlobal();
    return true;
  }

  public reorderBots(order: string[]): boolean {
    const newRunners = new Map<string, SingleBotRunner>();
    
    for (const id of order) {
      const runner = this.runners.get(id);
      if (runner) {
        newRunners.set(id, runner);
      }
    }
    
    for (const [id, runner] of this.runners.entries()) {
      if (!newRunners.has(id)) {
        newRunners.set(id, runner);
      }
    }
    
    this.runners = newRunners;
    this.saveConfigDisk();
    this.broadcastGlobal();
    return true;
  }

  private handleRunnerUpdate(type: 'log' | 'status', botId: string, payload: any) {
    if (type === 'log') {
      this.logSubscribers.forEach((sub) => sub({ botId, log: payload }));
    } else if (type === 'status') {
      this.statusSubscribers.forEach((sub) => sub({ botId, status: payload }));
    }
  }

  public subscribeLogs(callback: (payload: { botId: string; log: LogEntry }) => void) {
    this.logSubscribers.add(callback);
    return () => this.logSubscribers.delete(callback);
  }

  public subscribeStatus(callback: (payload: { botId: string; status: BotStatus }) => void) {
    this.statusSubscribers.add(callback);
    return () => this.statusSubscribers.delete(callback);
  }

  public subscribeGlobal(callback: () => void) {
    this.globalSubscribers.add(callback);
    return () => this.globalSubscribers.delete(callback);
  }

  private broadcastGlobal() {
    this.globalSubscribers.forEach((sub) => sub());
  }

  private saveConfigDisk() {
    try {
      const exportData = {
        adminPasscodeHash: this.adminPasscodeHash,
        bots: this.getBots().map((runner) => ({
          id: runner.id,
          name: runner.name,
          config: runner.config,
        })),
      };
      fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
      // Write-then-rename so a crash mid-write can't leave a truncated config behind.
      const tmpPath = CONFIG_PATH + '.tmp';
      fs.writeFileSync(tmpPath, JSON.stringify(exportData, null, 2), { encoding: 'utf-8', mode: 0o600 });
      try {
        fs.renameSync(tmpPath, CONFIG_PATH);
      } catch {
        // Renaming over a single-file bind mount fails on some Docker setups; fall back to an in-place write.
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(exportData, null, 2), 'utf-8');
        fs.rmSync(tmpPath, { force: true });
      }
    } catch (err: any) {
      console.error(`Failed to save config.json: ${err.message}`);
    }
  }

  private loadConfig() {
    try {
      if (!fs.existsSync(CONFIG_PATH) && fs.existsSync(EXAMPLE_CONFIG_PATH)) {
        fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
        fs.copyFileSync(EXAMPLE_CONFIG_PATH, CONFIG_PATH);
      }
      if (fs.existsSync(CONFIG_PATH)) {
        const content = fs.readFileSync(CONFIG_PATH, 'utf-8');
        const parsed = JSON.parse(content);

        let migratePasscode = false;
        if (parsed && typeof parsed === 'object') {
          if (typeof parsed.adminPasscodeHash === 'string') {
            this.adminPasscodeHash = parsed.adminPasscodeHash;
          } else if (typeof parsed.adminPasscode === 'string' && parsed.adminPasscode) {
            // Older versions stored the passcode in plain text; hash it and rewrite the file.
            this.adminPasscodeHash = hashPasscode(parsed.adminPasscode);
            migratePasscode = true;
          }
        }

        // Check format: old vs new
        if (parsed && Array.isArray(parsed.bots)) {
          // New list format
          for (const botData of parsed.bots) {
            const config = applyConfigPatch(DEFAULT_CONFIG, botData.config);
            const runner = new SingleBotRunner(
              botData.id,
              botData.name || 'Discord AI Bot',
              config,
              this.handleRunnerUpdate.bind(this)
            );
            this.runners.set(botData.id, runner);
          }
          if (migratePasscode) this.saveConfigDisk();
        } else if (parsed && typeof parsed === 'object' && parsed.discordToken !== undefined) {
          // Old single format migration
          const config = applyConfigPatch(DEFAULT_CONFIG, parsed);
          const runner = new SingleBotRunner(
            'default',
            'Primary Bot',
            config,
            this.handleRunnerUpdate.bind(this)
          );
          this.runners.set('default', runner);
          this.saveConfigDisk(); // rewrite in new format
        } else {
          // Empty or invalid structure
          this.createDefaultBot();
        }
      } else {
        this.createDefaultBot();
      }
    } catch (err: any) {
      console.error(`Failed to load config.json: ${err.message}`);
      this.createDefaultBot();
    }
  }

  private createDefaultBot() {
    const id = 'default';
    const runner = new SingleBotRunner(
      id,
      'Primary Bot',
      { ...DEFAULT_CONFIG },
      this.handleRunnerUpdate.bind(this)
    );
    this.runners.set(id, runner);
    this.saveConfigDisk();
  }

  public autoStartBots() {
    this.getBots().forEach((runner) => {
      if (runner.config.discordToken && runner.config.autoStart) {
        runner.addLog('info', `Auto-starting on container startup...`);
        runner.start().catch((err) => {
          runner.addLog('error', `Auto-start failed: ${err.message}`);
        });
      }
    });
  }

  /**
   * The dashboard never receives stored API keys, so when it asks to test a
   * connection or list models without typing a key, fall back to the key saved
   * for that bot.
   */
  public resolveApiKey(providedKey: unknown, botId: unknown): string {
    if (typeof providedKey === 'string' && providedKey.trim()) return providedKey.trim();
    if (typeof botId === 'string') return this.runners.get(botId)?.config.openaiApiKey || '';
    return '';
  }

  // Generic helpers
  public async fetchAvailableModels(testUrl: string, testKey: string): Promise<{ success: boolean; models: string[]; message?: string }> {
    const cleanUrl = (testUrl || '').trim();
    const cleanKey = (testKey || '').trim();
    try {
      const openai = new OpenAI({
        baseURL: cleanUrl,
        apiKey: cleanKey || 'no-key-required',
        timeout: 60000,
      });

      const response = await openai.models.list();
      const models = response.data.map((m) => m.id);
      return { success: true, models };
    } catch (err: any) {
      return { success: false, models: [], message: err.message };
    }
  }

  public async testOpenAIConnection(
    testUrl: string,
    testKey: string,
    testModel: string
  ): Promise<{ success: boolean; message: string }> {
    const cleanUrl = (testUrl || '').trim();
    const cleanKey = (testKey || '').trim();
    const cleanModel = (testModel || '').trim();

    if (!cleanModel) {
      return {
        success: false,
        message: "Connection test failed: No model selected. Choose a model first.",
      };
    }

    let baseUrl = cleanUrl;
    if (baseUrl.endsWith('/')) {
      baseUrl = baseUrl.slice(0, -1);
    }
    const completionsUrl = `${baseUrl}/chat/completions`;

    const makeRequest = async (includeMaxTokens: boolean) => {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (cleanKey) {
        headers['Authorization'] = `Bearer ${cleanKey}`;
      }

      const body: Record<string, any> = {
        model: cleanModel,
        messages: [{ role: 'user', content: 'Ping! Answer with "Pong!" only.' }],
        stream: false,
      };
      if (includeMaxTokens) {
        body.max_tokens = 10;
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000);

      try {
        const response = await fetch(completionsUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        return response;
      } catch (err: any) {
        clearTimeout(timeoutId);
        throw err;
      }
    };

    try {
      let response = await makeRequest(true);

      if (response.status === 400) {
        try {
          const fallbackResponse = await makeRequest(false);
          if (fallbackResponse.ok) {
            response = fallbackResponse;
          }
        } catch (_) {}
      }

      if (!response.ok) {
        const status = response.status;
        let responseText = '';
        try {
          responseText = await response.text();
        } catch (_) {}

        let detailedError = `HTTP ${status}`;
        if (responseText) {
          detailedError += `: ${responseText.slice(0, 300)}`;
        }
        return { success: false, message: `Connection test failed: ${detailedError}` };
      }

      const responseText = await response.text();
      let content = '';

      // Robust check for SSE (Server-Sent Events) stream format
      if (responseText.includes('data:')) {
        const lines = responseText.split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('data:')) {
            const dataStr = trimmed.slice(5).trim();
            if (dataStr === '[DONE]' || !dataStr) {
              continue;
            }
            try {
              const chunk = JSON.parse(dataStr);
              const chunkContent = chunk.choices?.[0]?.delta?.content || chunk.choices?.[0]?.message?.content || '';
              content += chunkContent;
            } catch (_) {}
          }
        }
      } else {
        try {
          const responseData = JSON.parse(responseText);
          content = responseData.choices?.[0]?.message?.content || '';
        } catch (e: any) {
          return {
            success: false,
            message: `Connection test failed to parse JSON: ${e.message}. Response was: "${responseText.slice(0, 200)}"`
          };
        }
      }

      return { success: true, message: `Connection test successful! Server replied: "${content.trim()}"` };
    } catch (err: any) {
      const errorMsg = err.name === 'AbortError' ? 'Request timed out after 60 seconds' : err.message;
      return { success: false, message: `Connection test failed: ${errorMsg}` };
    }
  }
}

export const botManager = new BotManager();
