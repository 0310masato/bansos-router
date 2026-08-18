export interface RateLimiterOptions {
  // max requests per window per IP. 0 disables.
  limit: number;
  windowMs: number;
}

export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(private readonly opts: RateLimiterOptions) {}

  // returns true when the request is allowed.
  check(ip: string, now = Date.now()): boolean {
    if (this.opts.limit <= 0) return true;
    const windowStart = now - this.opts.windowMs;
    const recent = (this.hits.get(ip) ?? []).filter((t) => t > windowStart);

    if (recent.length >= this.opts.limit) {
      this.hits.set(ip, recent);
      return false;
    }

    recent.push(now);
    this.hits.set(ip, recent);
    return true;
  }

  reset(): void {
    this.hits.clear();
  }
}
