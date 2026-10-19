// End-to-end checks of the HTTP API against a throwaway config with fake credentials.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';
import type { Server } from 'http';

const FAKE_TOKEN = 'FAKE.DISCORD.TOKEN-should-never-leak';
const FAKE_KEY = 'sk-fake-key-should-never-leak';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dbm-test-'));
const configPath = path.join(dir, 'config.json');
fs.writeFileSync(
  configPath,
  JSON.stringify({
    adminPasscode: '',
    bots: [{ id: 'default', name: 'Primary Bot', config: { discordToken: FAKE_TOKEN, openaiApiKey: FAKE_KEY, autoStart: false } }],
  })
);
process.env.CONFIG_PATH = configPath;
process.env.DBM_NO_LISTEN = '1';

// Capture the setup token the server prints.
const logged: string[] = [];
const origLog = console.log;

let server: Server;
let local: string; // via 127.0.0.1 (counts as "on the server")
let remote: string | null; // via a LAN address (counts as another machine)

before(async () => {
  console.log = (...args: unknown[]) => logged.push(args.join(' '));
  const { createApp } = await import('../server');
  const app = createApp();
  console.log = origLog;
  server = app.listen(0, '0.0.0.0');
  await new Promise((r) => server.once('listening', r));
  const port = (server.address() as AddressInfo).port;
  local = `http://127.0.0.1:${port}`;
  const lan = Object.values(os.networkInterfaces())
    .flat()
    .find((i) => i && i.family === 'IPv4' && !i.internal);
  remote = lan ? `http://${lan.address}:${port}` : null;
});

after(() => {
  server?.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const setupToken = () => {
  const line = logged.filter((l) => l.includes('setup token')).pop() || '';
  return line.split(': ').pop()!.trim();
};

async function call(base: string, method: string, url: string, body?: unknown, cookie?: string) {
  const res = await fetch(base + url, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const setCookie = res.headers.get('set-cookie');
  return { status: res.status, text, json: text ? JSON.parse(text) : null, cookie: setCookie?.split(';')[0] };
}

function assertNoSecrets(text: string) {
  assert.ok(!text.includes(FAKE_TOKEN), 'Discord token leaked');
  assert.ok(!text.includes(FAKE_KEY), 'API key leaked');
}

let session = '';

test('without a passcode, bot data is readable but secrets are stripped', async () => {
  const r = await call(local, 'GET', '/api/bots');
  assert.equal(r.status, 200);
  assertNoSecrets(r.text);
  assert.equal(r.json[0].config.hasDiscordToken, true);
  assert.equal(r.json[0].config.hasOpenaiApiKey, true);
  assert.ok(setupToken().length >= 12, 'setup token printed to log');
});

test('without a passcode the dashboard is read-only: no saves, starts, model lists or tests', async () => {
  for (const [method, url, body] of [
    ['PUT', '/api/bots/default', { name: 'x', config: { openaiBaseUrl: 'https://evil.example/v1' } }],
    ['POST', '/api/bots', { name: 'new', config: { discordToken: 'NEW.TOKEN' } }],
    ['POST', '/api/bots/default/start', {}],
    ['DELETE', '/api/bots/default', undefined],
    ['POST', '/api/models', { url: 'https://evil.example/v1', botId: 'default' }],
    ['POST', '/api/test-openai', { url: 'https://evil.example/v1', botId: 'default', model: 'm' }],
  ] as const) {
    const r = await call(local, method, url, body);
    assert.equal(r.status, 403, `${method} ${url}`);
    assert.equal(r.json.code, 'passcode-required');
    assertNoSecrets(r.text);
  }
  const stored = JSON.parse(fs.readFileSync(configPath, 'utf-8')).bots;
  assert.equal(stored.length, 1, 'no bot was created');
  assert.ok(!JSON.stringify(stored).includes('evil.example'), 'endpoint unchanged');
  assert.ok(!JSON.stringify(stored).includes('NEW.TOKEN'), 'no token saved');
});

test('a loopback request relayed by a reverse proxy does not count as local', async () => {
  const proxied = await fetch(local + '/api/security/status', { headers: { 'X-Forwarded-For': '203.0.113.9' } });
  assert.equal((await proxied.json()).setupTokenRequired, true);
  const direct = await call(local, 'GET', '/api/security/status');
  assert.equal(direct.json.setupTokenRequired, false);
  const res = await fetch(local + '/api/security/setup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.9' },
    body: JSON.stringify({ passcode: 'proxied-claim' }),
  });
  assert.equal(res.status, 403, 'needs the setup token');
});

test('a remote browser cannot set the first passcode without the setup token', async (t) => {
  if (!remote) return t.skip('no LAN address available');
  const status = await call(remote, 'GET', '/api/security/status');
  assert.equal(status.json.setupTokenRequired, true);
  const r = await call(remote, 'POST', '/api/security/setup', { passcode: 'hunter22' });
  assert.equal(r.status, 403);
  const wrong = await call(remote, 'POST', '/api/security/setup', { passcode: 'hunter22', setupToken: 'AAAA-AAAA-AAAA' });
  assert.equal(wrong.status, 403);
});

test('first passcode: too short is rejected, then set with the token', async () => {
  const base = remote || local;
  const short = await call(base, 'POST', '/api/security/setup', { passcode: '1234', setupToken: setupToken() });
  assert.equal(short.status, 400);
  const ok = await call(base, 'POST', '/api/security/setup', { passcode: 'correct-horse', setupToken: setupToken() });
  assert.equal(ok.status, 200, ok.text);
  assert.ok(ok.cookie?.startsWith('dbm_session='));
  session = ok.cookie!;
  const saved = fs.readFileSync(configPath, 'utf-8');
  assert.ok(!saved.includes('correct-horse'), 'passcode stored hashed');
  assert.match(saved, /"adminPasscodeHash": "scrypt\$/);
});

test('the setup token cannot be reused once a passcode exists', async () => {
  const r = await call(local, 'POST', '/api/security/setup', { passcode: 'attacker1', setupToken: setupToken() });
  assert.equal(r.status, 400, 'needs the current passcode now');
});

test('locked: bots, log stream, models and tests all require a session', async () => {
  for (const [method, url] of [
    ['GET', '/api/bots'],
    ['GET', '/api/logs/stream'],
    ['POST', '/api/models'],
    ['POST', '/api/test-openai'],
    ['PUT', '/api/bots/default'],
    ['POST', '/api/bots/default/start'],
  ] as const) {
    const r = await call(local, method, url, method === 'GET' ? undefined : {});
    assert.equal(r.status, 401, `${method} ${url}`);
    assertNoSecrets(r.text);
  }
  const forged = await call(local, 'GET', '/api/bots', undefined, 'dbm_session=forged');
  assert.equal(forged.status, 401);
});

test('with a session: data flows, secrets still stripped, including the SSE stream', async () => {
  const r = await call(local, 'GET', '/api/bots', undefined, session);
  assert.equal(r.status, 200);
  assertNoSecrets(r.text);

  const ac = new AbortController();
  const res = await fetch(local + '/api/logs/stream', { headers: { Cookie: session }, signal: ac.signal });
  assert.equal(res.status, 200);
  const reader = res.body!.getReader();
  const { value } = await reader.read();
  const first = new TextDecoder().decode(value);
  ac.abort();
  assert.match(first, /"type":"init"/);
  assertNoSecrets(first);
});

test('saving with blank secrets keeps them; typing replaces; null clears the key', async () => {
  const save = (config: unknown) => call(local, 'PUT', '/api/bots/default', { name: 'Renamed', config }, session);
  const stored = () => JSON.parse(fs.readFileSync(configPath, 'utf-8')).bots[0].config;

  assert.equal((await save({ discordToken: '', openaiApiKey: '', modelName: 'x', hasDiscordToken: false })).status, 200);
  assert.equal(stored().discordToken, FAKE_TOKEN);
  assert.equal(stored().openaiApiKey, FAKE_KEY);
  assert.equal(stored().modelName, 'x');
  assert.ok(!('hasDiscordToken' in stored()));

  await save({ openaiApiKey: null });
  assert.equal(stored().openaiApiKey, '');
  await save({ openaiApiKey: FAKE_KEY });
  assert.equal(stored().openaiApiKey, FAKE_KEY);
});

test("a saved key is only sent to that bot's saved endpoint", async () => {
  const other = await call(local, 'POST', '/api/models', { url: 'https://evil.example/v1', botId: 'default' }, session);
  assert.equal(other.status, 200);
  assert.equal(other.json.success, false);
  assert.match(other.json.message, /only sent to its saved endpoint/);
  const test = await call(local, 'POST', '/api/test-openai', { url: 'https://evil.example/v1', botId: 'default', model: 'm' }, session);
  assert.equal(test.json.success, false);
  assert.match(test.json.message, /only sent to its saved endpoint/);

  const { botManager } = await import('../src/bot-manager');
  assert.deepEqual(botManager.resolveApiKey('', 'default', 'https://API.openai.com/v1/'), { key: FAKE_KEY, refused: false });
  assert.deepEqual(botManager.resolveApiKey('', 'default', 'https://evil.example/v1'), { key: '', refused: true });
  assert.deepEqual(botManager.resolveApiKey('', 'default', ''), { key: '', refused: true });
  assert.deepEqual(botManager.resolveApiKey(' typed ', 'default', 'https://evil.example/v1'), { key: 'typed', refused: false });
  assert.deepEqual(botManager.resolveApiKey('', 'no-such-bot', 'https://evil.example/v1'), { key: '', refused: false });
});

test('cross-origin writes are rejected', async () => {
  const res = await fetch(local + '/api/bots/default/stop', {
    method: 'POST',
    headers: { Cookie: session, Origin: 'http://evil.example' },
  });
  assert.equal(res.status, 403);
});

test('wrong passcodes are rate limited', async (t) => {
  if (!remote) return t.skip('no LAN address available');
  const base = remote;
  let last = 0;
  for (let i = 0; i < 6; i++) last = (await call(base, 'POST', '/api/security/login', { passcode: 'wrong-' + i })).status;
  assert.equal(last, 429);
  // Even the right passcode is refused until the window passes.
  assert.equal((await call(base, 'POST', '/api/security/login', { passcode: 'correct-horse' })).status, 429);
});

test('logout and passcode changes end sessions', async () => {
  const login = await call(local, 'POST', '/api/security/login', { passcode: 'correct-horse' });
  assert.equal(login.status, 200);
  const s2 = login.cookie!;
  assert.equal((await call(local, 'GET', '/api/bots', undefined, s2)).status, 200);

  await call(local, 'POST', '/api/security/logout', undefined, s2);
  assert.equal((await call(local, 'GET', '/api/bots', undefined, s2)).status, 401);

  const change = await call(local, 'POST', '/api/security/setup', { passcode: 'new-passcode', currentPasscode: 'correct-horse' }, session);
  assert.equal(change.status, 200);
  assert.equal((await call(local, 'GET', '/api/bots', undefined, session)).status, 401, 'old session revoked');
  assert.equal((await call(local, 'GET', '/api/bots', undefined, change.cookie)).status, 200, 'new session issued');
});
