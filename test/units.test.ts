import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  hashPasscode,
  verifyPasscodeHash,
  AttemptLimiter,
  SessionStore,
  generateSetupToken,
  setupTokensMatch,
  parseCookies,
  isLoopbackAddress,
} from '../src/auth';
import { DEFAULT_CONFIG, applyConfigPatch, toPublicConfig } from '../src/config';
import { chunkText, UserCooldown } from '../src/discord-utils';

// --- auth -------------------------------------------------------------------

test('passcode hash verifies only the right passcode and never stores it in plain text', () => {
  const h = hashPasscode('correct horse');
  assert.ok(!h.includes('correct horse'));
  assert.ok(verifyPasscodeHash('correct horse', h));
  assert.ok(!verifyPasscodeHash('correct hors', h));
  assert.ok(!verifyPasscodeHash('', h));
  assert.ok(!verifyPasscodeHash(undefined, h));
  assert.ok(!verifyPasscodeHash({} as unknown, h));
  assert.notEqual(hashPasscode('same'), hashPasscode('same'), 'salted');
});

test('attempt limiter blocks after 5 failures per address and releases after the window', () => {
  let now = 0;
  const lim = new AttemptLimiter(5, 30, 60_000, () => now);
  for (let i = 0; i < 5; i++) {
    assert.equal(lim.retryAfter('a'), 0);
    lim.recordFailure('a');
  }
  assert.ok(lim.retryAfter('a') > 0);
  assert.equal(lim.retryAfter('b'), 0, 'other addresses unaffected');
  now = 61_000;
  assert.equal(lim.retryAfter('a'), 0);
});

test('attempt limiter has a global ceiling across addresses', () => {
  const lim = new AttemptLimiter(5, 10, 60_000, () => 0);
  for (let i = 0; i < 10; i++) lim.recordFailure('ip' + i);
  assert.ok(lim.retryAfter('fresh') > 0);
});

test('sessions expire and can be revoked', () => {
  let now = 0;
  const s = new SessionStore(1000, () => now);
  const a = s.create();
  const b = s.create();
  assert.ok(s.isValid(a) && s.isValid(b));
  assert.ok(!s.isValid('nope') && !s.isValid(undefined));
  s.revoke(a);
  assert.ok(!s.isValid(a) && s.isValid(b));
  now = 1001;
  assert.ok(!s.isValid(b));
  const c = s.create();
  s.revokeAll();
  assert.ok(!s.isValid(c));
});

test('setup token format and matching', () => {
  const t = generateSetupToken();
  assert.match(t, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.ok(setupTokensMatch(t, t));
  assert.ok(setupTokensMatch(t.toLowerCase().replace(/-/g, ' '), t), 'case and separators ignored');
  assert.ok(!setupTokensMatch('AAAA-AAAA-AAAA', t));
  assert.ok(!setupTokensMatch(t, null));
  assert.ok(!setupTokensMatch(undefined, t));
});

test('cookie parsing and loopback detection', () => {
  assert.deepEqual(parseCookies('a=1; dbm_session=abc%3D; x'), { a: '1', dbm_session: 'abc=' });
  assert.deepEqual(parseCookies(undefined), {});
  assert.ok(isLoopbackAddress('127.0.0.1') && isLoopbackAddress('::1') && isLoopbackAddress('::ffff:127.0.0.1'));
  assert.ok(!isLoopbackAddress('172.17.0.1') && !isLoopbackAddress(undefined));
});

// --- config -----------------------------------------------------------------

const stored = { ...DEFAULT_CONFIG, discordToken: 'TOKEN', openaiApiKey: 'KEY' };

test('blank or missing secrets keep the stored value', () => {
  assert.equal(applyConfigPatch(stored, { discordToken: '', openaiApiKey: '   ' }).discordToken, 'TOKEN');
  const next = applyConfigPatch(stored, { modelName: 'm' });
  assert.equal(next.discordToken, 'TOKEN');
  assert.equal(next.openaiApiKey, 'KEY');
  assert.equal(next.modelName, 'm');
});

test('typed secrets replace, null clears', () => {
  const next = applyConfigPatch(stored, { discordToken: ' NEW ', openaiApiKey: null });
  assert.equal(next.discordToken, 'NEW');
  assert.equal(next.openaiApiKey, '');
});

test('unknown keys and wrong types are ignored; cooldown is clamped', () => {
  const next = applyConfigPatch(stored, {
    hasDiscordToken: false,
    evil: 'x',
    temperature: 'hot',
    maxTokens: '256',
    autoStart: 'yes',
    userCooldownSeconds: -4,
  }) as unknown as Record<string, unknown>;
  assert.ok(!('hasDiscordToken' in next) && !('evil' in next));
  assert.equal(next.temperature, DEFAULT_CONFIG.temperature);
  assert.equal(next.maxTokens, 256);
  assert.equal(next.autoStart, DEFAULT_CONFIG.autoStart);
  assert.equal(next.userCooldownSeconds, 0);
  assert.deepEqual(applyConfigPatch(stored, null), stored);
});

test('public config never contains secrets', () => {
  const pub = toPublicConfig(stored);
  assert.equal(pub.discordToken, '');
  assert.equal(pub.openaiApiKey, '');
  assert.equal(pub.hasDiscordToken, true);
  assert.equal(pub.hasOpenaiApiKey, true);
  assert.ok(!JSON.stringify(pub).includes('TOKEN') && !JSON.stringify(pub).includes('KEY"'));
  assert.equal(toPublicConfig(DEFAULT_CONFIG).hasDiscordToken, false);
});

// --- discord utils ----------------------------------------------------------

test('chunkText keeps every chunk within the limit, including one huge line', () => {
  const words = Array.from({ length: 2000 }, (_, i) => `word${i}`).join(' ');
  const noSpaces = 'x'.repeat(5000);
  const text = `intro\n${words}\nmiddle\n${noSpaces}\nend`;
  const chunks = chunkText(text, 1950);
  assert.ok(chunks.length > 3);
  for (const c of chunks) assert.ok(c.length <= 1950, `chunk of ${c.length}`);
  const squash = (s: string) => s.replace(/\s+/g, '');
  assert.equal(squash(chunks.join('')), squash(text), 'no content lost');
});

test('chunkText leaves short text alone and drops empty chunks', () => {
  assert.deepEqual(chunkText('hello\nworld', 1950), ['hello\nworld']);
  assert.deepEqual(chunkText('', 1950), []);
  assert.deepEqual(chunkText('a'.repeat(10), 4), ['aaaa', 'aaaa', 'aa']);
});

test('user cooldown: one in flight, then wait out the cooldown', () => {
  let now = 0;
  const cd = new UserCooldown(() => now);
  assert.ok(cd.tryAcquire('u', 5));
  assert.ok(!cd.tryAcquire('u', 5), 'still in flight');
  assert.ok(cd.tryAcquire('other', 5));
  cd.release('u');
  now = 4000;
  assert.ok(!cd.tryAcquire('u', 5), 'cooldown');
  now = 5000;
  assert.ok(cd.tryAcquire('u', 5));
  cd.release('u');
  assert.ok(cd.tryAcquire('u', 0), 'cooldown 0 only blocks concurrent requests');
});
