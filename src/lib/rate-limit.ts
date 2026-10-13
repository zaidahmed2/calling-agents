export type RateLimitOptions = {
  limit: number;
  windowMs: number;
  now?: () => number;
};

export type RateLimiter = {
  limit: number;
  windowMs: number;
  now: () => number;
  buckets: Map<string, number[]>;
};

export function createRateLimiter(options: RateLimitOptions): RateLimiter {
  return {
    limit: Math.max(1, options.limit),
    windowMs: Math.max(1, options.windowMs),
    now: options.now ?? (() => Date.now()),
    buckets: new Map(),
  };
}

export function isWithinRateLimit(limiter: RateLimiter, key: string): boolean {
  const now = limiter.now();
  const current = limiter.buckets.get(key) ?? [];
  const recentRequests = current.filter((timestamp) => now - timestamp < limiter.windowMs);

  if (recentRequests.length >= limiter.limit) {
    limiter.buckets.set(key, recentRequests);
    return false;
  }

  recentRequests.push(now);
  limiter.buckets.set(key, recentRequests);
  return true;
}

export function resetRateLimit(limiter: RateLimiter, key: string) {
  limiter.buckets.delete(key);
}
