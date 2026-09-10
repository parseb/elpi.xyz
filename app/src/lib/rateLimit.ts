import { NextRequest, NextResponse } from "next/server";

interface RateLimitStore {
  timestamps: number[];
}

const store = new Map<string, RateLimitStore>();

// Cleanup stale IP entries every 5 minutes to prevent memory leaks
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
let lastCleanup = Date.now();

function cleanupStore(windowMs: number) {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;

  const cutoff = now - windowMs;
  for (const [ip, data] of store.entries()) {
    const validTimestamps = data.timestamps.filter((t) => t > cutoff);
    if (validTimestamps.length === 0) {
      store.delete(ip);
    } else {
      store.set(ip, { timestamps: validTimestamps });
    }
  }
}

export interface RateLimitOptions {
  limit?: number; // Maximum number of requests allowed in window (default 60)
  windowMs?: number; // Time window in milliseconds (default 60000 = 1 minute)
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetSeconds: number;
}

export function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const ips = forwarded.split(",").map((ip) => ip.trim());
    if (ips[0]) return ips[0];
  }
  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  return "127.0.0.1";
}

export function rateLimit(request: NextRequest, options: RateLimitOptions = {}): RateLimitResult {
  const limit = options.limit ?? 60;
  const windowMs = options.windowMs ?? 60_000;
  const now = Date.now();

  cleanupStore(windowMs);

  const clientIp = getClientIp(request);
  const key = `${clientIp}`;

  const currentStore = store.get(key) || { timestamps: [] };
  // Filter timestamps within the current sliding window
  const validTimestamps = currentStore.timestamps.filter((t) => t > now - windowMs);

  if (validTimestamps.length >= limit) {
    const oldestTimestamp = validTimestamps[0];
    const resetMs = oldestTimestamp + windowMs - now;
    const resetSeconds = Math.ceil(resetMs / 1000);

    return {
      allowed: false,
      limit,
      remaining: 0,
      resetSeconds: Math.max(1, resetSeconds),
    };
  }

  validTimestamps.push(now);
  store.set(key, { timestamps: validTimestamps });

  const remaining = limit - validTimestamps.length;
  const resetSeconds = Math.ceil(windowMs / 1000);

  return {
    allowed: true,
    limit,
    remaining,
    resetSeconds,
  };
}

/**
 * Checks rate limit for an incoming request. Returns a 429 NextResponse if rate limit is exceeded,
 * or null if allowed (with helper headers populated).
 */
export function checkRateLimit(request: NextRequest, options: RateLimitOptions = {}): NextResponse | null {
  const res = rateLimit(request, options);

  if (!res.allowed) {
    return NextResponse.json(
      {
        error: "Too Many Requests",
        message: `Rate limit exceeded. Maximum ${res.limit} requests per ${Math.round((options.windowMs ?? 60000) / 1000)}s allowed.`,
      },
      {
        status: 429,
        headers: {
          "X-RateLimit-Limit": res.limit.toString(),
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": res.resetSeconds.toString(),
          "Retry-After": res.resetSeconds.toString(),
        },
      },
    );
  }

  return null;
}
