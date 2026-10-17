/**
 * Split text into pieces no longer than `limit`, preferring line breaks, then
 * spaces, and only cutting mid-word when a single word is longer than the limit.
 * Discord rejects messages over 2,000 characters.
 */
export function chunkText(text: string, limit = 1950): string[] {
  const chunks: string[] = [];
  let current = '';

  const pushCurrent = () => {
    if (current.trim()) chunks.push(current);
    current = '';
  };

  for (const rawLine of text.split('\n')) {
    let line = rawLine;

    // Break up any single line that is itself too long.
    while (line.length > limit) {
      pushCurrent();
      let cut = line.lastIndexOf(' ', limit);
      if (cut <= 0) cut = limit;
      chunks.push(line.slice(0, cut));
      line = line.slice(cut).replace(/^ +/, '');
    }

    const candidate = current ? current + '\n' + line : line;
    if (candidate.length > limit) {
      pushCurrent();
      current = line;
    } else {
      current = candidate;
    }
  }
  pushCurrent();
  return chunks;
}

/**
 * Per-user rate limit: one request in flight per user, and at least
 * `cooldownSeconds` between the start of one request and the next.
 */
export class UserCooldown {
  private lastStart = new Map<string, number>();
  private inFlight = new Set<string>();

  constructor(private now: () => number = Date.now) {}

  /** Returns true and marks the user busy if they may send a request now. */
  tryAcquire(userId: string, cooldownSeconds: number): boolean {
    if (this.inFlight.has(userId)) return false;
    const last = this.lastStart.get(userId);
    const t = this.now();
    if (cooldownSeconds > 0 && last !== undefined && t - last < cooldownSeconds * 1000) return false;

    this.inFlight.add(userId);
    this.lastStart.set(userId, t);
    if (this.lastStart.size > 5000) this.prune(cooldownSeconds);
    return true;
  }

  release(userId: string) {
    this.inFlight.delete(userId);
  }

  private prune(cooldownSeconds: number) {
    const cutoff = this.now() - Math.max(cooldownSeconds, 60) * 1000;
    for (const [id, t] of this.lastStart) {
      if (t < cutoff && !this.inFlight.has(id)) this.lastStart.delete(id);
    }
  }
}

/** Never let the bot ping @everyone, @here, roles or users from AI output. */
export const NO_MENTIONS = { parse: [] as never[] };
/** Same, but still notify the person being replied to. */
export const REPLY_NO_MENTIONS = { parse: [] as never[], repliedUser: true };
