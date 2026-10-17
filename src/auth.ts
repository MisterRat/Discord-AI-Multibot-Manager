import crypto from 'crypto';

// ---------------------------------------------------------------------------
// Passcode hashing (scrypt, built into Node — no extra dependency)
// Stored format: scrypt$<saltHex>$<hashHex>
// ---------------------------------------------------------------------------

const SCRYPT_KEYLEN = 32;

export function hashPasscode(passcode: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(passcode, salt, SCRYPT_KEYLEN);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPasscodeHash(passcode: unknown, stored: string): boolean {
  if (typeof passcode !== 'string' || !passcode || !stored) return false;
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[1], 'hex');
  const expected = Buffer.from(parts[2], 'hex');
  const actual = crypto.scryptSync(passcode, salt, expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

export const MIN_PASSCODE_LENGTH = 6;

// ---------------------------------------------------------------------------
// Failed-attempt limiter: per client address, plus a global ceiling so a
// spread-out guessing attempt (or everything arriving via one proxy address)
// is still slowed down.
// ---------------------------------------------------------------------------

export class AttemptLimiter {
  private failures = new Map<string, number[]>();
  private global: number[] = [];

  constructor(
    private perKeyLimit = 5,
    private globalLimit = 30,
    private windowMs = 15 * 60 * 1000,
    private now: () => number = Date.now
  ) {}

  private prune(list: number[]): number[] {
    const cutoff = this.now() - this.windowMs;
    return list.filter((t) => t > cutoff);
  }

  /** Seconds until another attempt is allowed, or 0 if allowed now. */
  retryAfter(key: string): number {
    const mine = this.prune(this.failures.get(key) || []);
    this.global = this.prune(this.global);
    if (mine.length) this.failures.set(key, mine);
    else this.failures.delete(key);

    let waitUntil = 0;
    if (mine.length >= this.perKeyLimit) waitUntil = Math.max(waitUntil, mine[0] + this.windowMs);
    if (this.global.length >= this.globalLimit) waitUntil = Math.max(waitUntil, this.global[0] + this.windowMs);
    return waitUntil ? Math.max(1, Math.ceil((waitUntil - this.now()) / 1000)) : 0;
  }

  recordFailure(key: string) {
    const t = this.now();
    const mine = this.failures.get(key) || [];
    mine.push(t);
    this.failures.set(key, mine);
    this.global.push(t);
  }

  recordSuccess(key: string) {
    this.failures.delete(key);
  }
}

// ---------------------------------------------------------------------------
// In-memory sessions. A server restart signs everyone out, which is fine for
// a single-admin dashboard.
// ---------------------------------------------------------------------------

export const SESSION_COOKIE = 'dbm_session';
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export class SessionStore {
  private sessions = new Map<string, number>();

  constructor(private ttlMs = SESSION_TTL_MS, private now: () => number = Date.now) {}

  create(): string {
    const token = crypto.randomBytes(32).toString('base64url');
    this.sessions.set(token, this.now() + this.ttlMs);
    return token;
  }

  isValid(token: string | undefined | null): boolean {
    if (!token) return false;
    const expires = this.sessions.get(token);
    if (!expires) return false;
    if (expires <= this.now()) {
      this.sessions.delete(token);
      return false;
    }
    return true;
  }

  revoke(token: string | undefined | null) {
    if (token) this.sessions.delete(token);
  }

  revokeAll() {
    this.sessions.clear();
  }
}

// ---------------------------------------------------------------------------
// One-time setup token, printed to the server log while no passcode is set.
// Lets a remote browser (e.g. a NAS behind Docker port mapping) claim the
// dashboard without letting anyone else on the network do so first.
// ---------------------------------------------------------------------------

export function generateSetupToken(): string {
  // Unambiguous characters, grouped for easy typing: ABCD-EFGH-JKLM
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(12);
  let out = '';
  for (let i = 0; i < 12; i++) {
    if (i && i % 4 === 0) out += '-';
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

export function setupTokensMatch(provided: unknown, expected: string | null): boolean {
  if (!expected || typeof provided !== 'string') return false;
  const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const a = Buffer.from(norm(provided));
  const b = Buffer.from(norm(expected));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---------------------------------------------------------------------------
// Small request helpers
// ---------------------------------------------------------------------------

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) {
      try {
        out[key] = decodeURIComponent(value);
      } catch {
        out[key] = value;
      }
    }
  }
  return out;
}

/** True only for connections that really come from this machine (no proxy headers trusted). */
export function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) return false;
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}
