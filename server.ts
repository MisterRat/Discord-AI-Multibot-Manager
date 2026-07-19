import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { botManager } from "./src/bot-manager";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Passcode verification middleware
  const requirePasscode = (req: any, res: any, next: any) => {
    if (botManager.getHasPasscode()) {
      const providedCode = req.headers["x-admin-passcode"];
      if (!botManager.verifyPasscode(providedCode)) {
        return res.status(401).json({ error: "Unauthorized: Invalid or missing admin passcode" });
      }
    }
    next();
  };

  // Security Endpoints
  app.get("/api/security/status", (req, res) => {
    res.json({ hasPasscode: botManager.getHasPasscode() });
  });

  app.post("/api/security/verify", (req, res) => {
    const { passcode } = req.body;
    const success = botManager.verifyPasscode(passcode);
    res.json({ success });
  });

  app.post("/api/security/setup", (req, res) => {
    const { passcode, currentPasscode } = req.body;
    const success = botManager.setPasscode(passcode || '', currentPasscode || '');
    if (success) {
      res.json({ success: true, message: passcode ? "Passcode set successfully" : "Passcode cleared successfully" });
    } else {
      res.status(400).json({ error: "Invalid current passcode" });
    }
  });

  // API Routes
  app.get("/api/bots", (req, res) => {
    res.json(botManager.getBotsData());
  });

  app.post("/api/bots/reorder", requirePasscode, (req, res) => {
    const { order } = req.body;
    if (!Array.isArray(order)) {
      return res.status(400).json({ error: "Order array of bot IDs is required" });
    }
    const success = botManager.reorderBots(order);
    if (success) {
      res.json({ success: true });
    } else {
      res.status(400).json({ error: "Failed to reorder bots" });
    }
  });

  app.post("/api/bots", requirePasscode, (req, res) => {
    const { name, config } = req.body;
    if (!name) {
      return res.status(400).json({ error: "Bot name is required" });
    }
    const runner = botManager.createBot(name, config);
    res.json({ success: true, bot: { id: runner.id, name: runner.name, config: runner.config, status: runner.getStatus() } });
  });

  app.put("/api/bots/:id", requirePasscode, (req, res) => {
    const { id } = req.params;
    const { name, config } = req.body;
    const success = botManager.updateBot(id, name, config);
    if (success) {
      const runner = botManager.getBot(id);
      res.json({ success: true, bot: runner ? { id: runner.id, name: runner.name, config: runner.config } : null });
    } else {
      res.status(404).json({ error: "Bot not found" });
    }
  });

  app.delete("/api/bots/:id", requirePasscode, async (req, res) => {
    const { id } = req.params;
    const success = await botManager.deleteBot(id);
    if (success) {
      res.json({ success: true });
    } else {
      res.status(404).json({ error: "Bot not found" });
    }
  });

  app.post("/api/bots/:id/start", requirePasscode, async (req, res) => {
    const { id } = req.params;
    const runner = botManager.getBot(id);
    if (!runner) {
      return res.status(404).json({ error: "Bot not found" });
    }
    const success = await runner.start();
    res.json({ success, status: runner.getStatus() });
  });

  app.post("/api/bots/:id/stop", requirePasscode, async (req, res) => {
    const { id } = req.params;
    const runner = botManager.getBot(id);
    if (!runner) {
      return res.status(404).json({ error: "Bot not found" });
    }
    const success = await runner.stop();
    res.json({ success, status: runner.getStatus() });
  });

  app.post("/api/bots/:id/clear-history", requirePasscode, (req, res) => {
    const { id } = req.params;
    const runner = botManager.getBot(id);
    if (!runner) {
      return res.status(404).json({ error: "Bot not found" });
    }
    runner.clearHistory(req.body.channelId || "");
    res.json({ success: true });
  });

  app.post("/api/test-openai", requirePasscode, async (req, res) => {
    const { url, apiKey, model } = req.body;
    const result = await botManager.testOpenAIConnection(url, apiKey, model);
    res.json(result);
  });

  app.post("/api/models", async (req, res) => {
    const { url, apiKey } = req.body;
    const result = await botManager.fetchAvailableModels(url, apiKey);
    res.json(result);
  });

  app.get("/api/logs/stream", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    
    res.flushHeaders();

    // Send initial status and log dump for all bots
    const initData = {
      type: "init",
      bots: botManager.getBotsData()
    };
    res.write(`data: ${JSON.stringify(initData)}\n\n`);

    // Keep connection alive with periodic comments
    const keepAliveInterval = setInterval(() => {
      res.write(': keep-alive\n\n');
    }, 15000);

    const unsubscribeLogs = botManager.subscribeLogs((payload) => {
      res.write(`data: ${JSON.stringify({ type: 'log', botId: payload.botId, data: payload.log })}\n\n`);
    });

    const unsubscribeStatus = botManager.subscribeStatus((payload) => {
      res.write(`data: ${JSON.stringify({ type: 'status', botId: payload.botId, data: payload.status })}\n\n`);
    });

    const unsubscribeGlobal = botManager.subscribeGlobal(() => {
      res.write(`data: ${JSON.stringify({ type: 'bots', data: botManager.getBotsData() })}\n\n`);
    });

    req.on("close", () => {
      clearInterval(keepAliveInterval);
      unsubscribeLogs();
      unsubscribeStatus();
      unsubscribeGlobal();
    });
  });

  // Vite middleware for dev or Static asset serving for prod
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
    
    // Auto-start any configured bots that have autoStart active
    try {
      botManager.autoStartBots();
    } catch (err: any) {
      console.error(`Error during bot autostart: ${err.message}`);
    }
  });
}

startServer();
