import 'dotenv/config';
import express, { NextFunction, Request, Response } from 'express';
import path from 'path';
import { botManager } from './src/bot-manager';
import {
  AttemptLimiter,
  SessionStore,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  MIN_PASSCODE_LENGTH,
  generateSetupToken,
  setupTokensMatch,
  parseCookies,
  isLoopbackAddress,
} from './src/auth';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '200kb' }));

  const sessions = new SessionStore();
  const limiter = new AttemptLimiter();

  // While no passcode is set, a one-time setup token is printed to the log.
  // Only someone who can read the server/container log (or who is on the
  // server itself) can claim the dashboard by setting the first passcode.
  let setupToken: string | null = null;
  const refreshSetupToken = () => {
    if (botManager.getHasPasscode()) {
      setupToken = null;
      return;
    }
    setupToken = generateSetupToken();
    console.log('');
    console.log('================================================================');
    console.log(' No admin passcode is set. Anyone who can reach this dashboard');
    console.log(' can control your bots until you set one.');
    console.log(` One-time setup token: ${setupToken}`);
    console.log(' Enter it in the dashboard under UI Lock > Setup.');
    console.log('================================================================');
    console.log('');
  };
  refreshSetupToken();

  const clientKey = (req: Request) => req.socket.remoteAddress || 'unknown';
  const sessionToken = (req: Request) => parseCookies(req.headers.cookie)[SESSION_COOKIE];

  const setSessionCookie = (req: Request, res: Response, token: string) => {
    const parts = [
      `${SESSION_COOKIE}=${token}`,
      'Path=/',
      'HttpOnly',
      'SameSite=Strict',
      `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
    ];
    if (req.secure) parts.push('Secure');
    res.setHeader('Set-Cookie', parts.join('; '));
  };
  const clearSessionCookie = (res: Response) => {
    res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
  };

  /** Authenticated if no passcode is configured, or the request carries a live session cookie. */
  const isAuthorized = (req: Request) => !botManager.getHasPasscode() || sessions.isValid(sessionToken(req));

  const requireAuth = (req: Request, res: Response, next: NextFunction) => {
    if (!isAuthorized(req)) {
      return res.status(401).json({ error: 'Unauthorized: unlock the dashboard with the admin passcode' });
    }
    next();
  };

  const rateLimited = (req: Request, res: Response): boolean => {
    const wait = limiter.retryAfter(clientKey(req));
    if (wait > 0) {
      res.setHeader('Retry-After', String(wait));
      res.status(429).json({ error: `Too many failed attempts. Try again in ${Math.ceil(wait / 60)} minute(s).` });
      return true;
    }
    return false;
  };

  // Reject cross-site state-changing requests (defence in depth on top of SameSite cookies).
  app.use('/api', (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD') return next();
    const origin = req.headers.origin;
    if (origin) {
      try {
        if (new URL(origin).host !== req.headers.host) {
          return res.status(403).json({ error: 'Cross-origin request rejected' });
        }
      } catch {
        return res.status(403).json({ error: 'Invalid Origin header' });
      }
    }
    next();
  });

  // ---------------------------------------------------------------------------
  // Security endpoints (reachable without a session)
  // ---------------------------------------------------------------------------

  app.get('/api/security/status', (req, res) => {
    res.json({
      hasPasscode: botManager.getHasPasscode(),
      authenticated: isAuthorized(req),
      // When false, this browser is on the server itself and needs no setup token.
      setupTokenRequired: !botManager.getHasPasscode() && !isLoopbackAddress(req.socket.remoteAddress),
      minPasscodeLength: MIN_PASSCODE_LENGTH,
    });
  });

  app.post('/api/security/login', (req, res) => {
    if (!botManager.getHasPasscode()) {
      return res.json({ success: true });
    }
    if (rateLimited(req, res)) return;
    if (!botManager.verifyPasscode(req.body?.passcode)) {
      limiter.recordFailure(clientKey(req));
      return res.status(401).json({ success: false, error: 'Invalid passcode. Access denied.' });
    }
    limiter.recordSuccess(clientKey(req));
    sessions.revoke(sessionToken(req));
    setSessionCookie(req, res, sessions.create());
    res.json({ success: true });
  });

  app.post('/api/security/logout', (req, res) => {
    sessions.revoke(sessionToken(req));
    clearSessionCookie(res);
    res.json({ success: true });
  });

  app.post('/api/security/setup', (req, res) => {
    const passcode = typeof req.body?.passcode === 'string' ? req.body.passcode : '';
    const currentPasscode = typeof req.body?.currentPasscode === 'string' ? req.body.currentPasscode : '';
    const hadPasscode = botManager.getHasPasscode();

    if (rateLimited(req, res)) return;

    if (!hadPasscode) {
      // First-time setup: only from the server itself, or with the token from the log.
      const local = isLoopbackAddress(req.socket.remoteAddress);
      if (!local && !setupTokensMatch(req.body?.setupToken, setupToken)) {
        limiter.recordFailure(clientKey(req));
        return res.status(403).json({
          error: 'Setup token is missing or wrong. Copy the one-time setup token from the server or container log.',
        });
      }
      if (!passcode) {
        return res.status(400).json({ error: 'Enter a new passcode.' });
      }
    }

    const result = botManager.setPasscode(passcode, currentPasscode);
    if (!result.ok) {
      if (result.reason === 'wrong-current') {
        limiter.recordFailure(clientKey(req));
        return res.status(400).json({ error: 'Invalid current passcode' });
      }
      return res.status(400).json({ error: `Passcode must be at least ${MIN_PASSCODE_LENGTH} characters.` });
    }
    limiter.recordSuccess(clientKey(req));

    // Any change signs out every other browser.
    sessions.revokeAll();
    if (passcode) {
      setupToken = null;
      setSessionCookie(req, res, sessions.create());
    } else {
      clearSessionCookie(res);
      refreshSetupToken();
    }
    res.json({ success: true, message: passcode ? 'Passcode set successfully' : 'Passcode cleared successfully' });
  });

  // ---------------------------------------------------------------------------
  // Everything else under /api requires a session (when a passcode is set)
  // ---------------------------------------------------------------------------

  app.use('/api', requireAuth);

  app.get('/api/bots', (req, res) => {
    res.json(botManager.getBotsData());
  });

  app.post('/api/bots/reorder', (req, res) => {
    const { order } = req.body || {};
    if (!Array.isArray(order)) {
      return res.status(400).json({ error: 'Order array of bot IDs is required' });
    }
    const success = botManager.reorderBots(order.filter((id: unknown) => typeof id === 'string'));
    if (success) {
      res.json({ success: true });
    } else {
      res.status(400).json({ error: 'Failed to reorder bots' });
    }
  });

  app.post('/api/bots', (req, res) => {
    const { name, config } = req.body || {};
    if (typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Bot name is required' });
    }
    const runner = botManager.createBot(name.trim(), config);
    res.json({ success: true, bot: { id: runner.id, name: runner.name, status: runner.getStatus() } });
  });

  app.put('/api/bots/:id', (req, res) => {
    const { id } = req.params;
    const { name, config } = req.body || {};
    const success = botManager.updateBot(id, name, config);
    if (success) {
      const runner = botManager.getBot(id);
      res.json({ success: true, bot: runner ? { id: runner.id, name: runner.name } : null });
    } else {
      res.status(404).json({ error: 'Bot not found' });
    }
  });

  app.delete('/api/bots/:id', async (req, res) => {
    const success = await botManager.deleteBot(req.params.id);
    if (success) {
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Bot not found' });
    }
  });

  app.post('/api/bots/:id/start', async (req, res) => {
    const runner = botManager.getBot(req.params.id);
    if (!runner) {
      return res.status(404).json({ error: 'Bot not found' });
    }
    const success = await runner.start();
    res.json({ success, status: runner.getStatus() });
  });

  app.post('/api/bots/:id/stop', async (req, res) => {
    const runner = botManager.getBot(req.params.id);
    if (!runner) {
      return res.status(404).json({ error: 'Bot not found' });
    }
    const success = await runner.stop();
    res.json({ success, status: runner.getStatus() });
  });

  app.post('/api/bots/:id/clear-history', (req, res) => {
    const runner = botManager.getBot(req.params.id);
    if (!runner) {
      return res.status(404).json({ error: 'Bot not found' });
    }
    runner.clearHistory(req.body?.channelId || '');
    res.json({ success: true });
  });

  app.post('/api/test-openai', async (req, res) => {
    const { url, apiKey, model, botId } = req.body || {};
    const result = await botManager.testOpenAIConnection(url, botManager.resolveApiKey(apiKey, botId), model);
    res.json(result);
  });

  app.post('/api/models', async (req, res) => {
    const { url, apiKey, botId } = req.body || {};
    const result = await botManager.fetchAvailableModels(url, botManager.resolveApiKey(apiKey, botId));
    res.json(result);
  });

  app.get('/api/logs/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const send = (payload: unknown) => res.write(`data: ${JSON.stringify(payload)}\n\n`);

    send({ type: 'init', bots: botManager.getBotsData() });

    const unsubscribeLogs = botManager.subscribeLogs((payload) => {
      send({ type: 'log', botId: payload.botId, data: payload.log });
    });
    const unsubscribeStatus = botManager.subscribeStatus((payload) => {
      send({ type: 'status', botId: payload.botId, data: payload.status });
    });
    const unsubscribeGlobal = botManager.subscribeGlobal(() => {
      send({ type: 'bots', data: botManager.getBotsData() });
    });

    let keepAliveInterval: NodeJS.Timeout;
    const cleanup = () => {
      clearInterval(keepAliveInterval);
      unsubscribeLogs();
      unsubscribeStatus();
      unsubscribeGlobal();
    };

    // Keep the connection alive, and end it once the session is no longer valid
    // (signed out, passcode changed, or expired).
    keepAliveInterval = setInterval(() => {
      if (!isAuthorized(req)) {
        send({ type: 'auth', data: 'expired' });
        cleanup();
        res.end();
        return;
      }
      res.write(': keep-alive\n\n');
    }, 15000);

    req.on('close', cleanup);
  });

  // Unknown API routes should not fall through to the SPA.
  app.use('/api', (req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  return app;
}

async function startServer() {
  const app = createApp();
  const PORT = Number(process.env.PORT) || 3000;

  // Vite middleware for dev, static assets for production. Vite is imported
  // lazily so the production image doesn't need it installed.
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);

    // Auto-start any configured bots that have autoStart active
    try {
      botManager.autoStartBots();
    } catch (err: any) {
      console.error(`Error during bot autostart: ${err.message}`);
    }
  });
}

if (process.env.DBM_NO_LISTEN !== '1') {
  startServer();
}
