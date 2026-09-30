import type { IncomingMessage } from 'node:http';
import { isIP } from 'node:net';

export type ApiRateLimitOptions = {
  perIp: number;
  global: number;
  maxConcurrent: number;
  trustProxyHeader: boolean;
};

export type ApiAdmission =
  | { allowed: true; release: () => void }
  | { allowed: false; retryAfterSeconds: number };

const WINDOW_MS = 60_000;

export function getApiRateLimitOptions(env: NodeJS.ProcessEnv = process.env): ApiRateLimitOptions {
  return {
    perIp: readPositiveInteger(env.API_RATE_LIMIT_PER_IP, 60, 'API_RATE_LIMIT_PER_IP'),
    global: readPositiveInteger(env.API_RATE_LIMIT_GLOBAL, 300, 'API_RATE_LIMIT_GLOBAL'),
    maxConcurrent: readPositiveInteger(env.API_MAX_CONCURRENT_REQUESTS, 8, 'API_MAX_CONCURRENT_REQUESTS'),
    trustProxyHeader: env.API_TRUST_PROXY_HEADER === 'true',
  };
}

export function createApiRateLimiter(
  options: ApiRateLimitOptions,
  now: () => number = Date.now,
): (request: IncomingMessage) => ApiAdmission {
  const counts = new Map<string, number>();
  let windowStart = now();
  let total = 0;
  let active = 0;

  return (request) => {
    const currentTime = now();
    if (currentTime - windowStart >= WINDOW_MS) {
      windowStart = currentTime;
      total = 0;
      counts.clear();
    }

    const ip = getClientIp(request, options.trustProxyHeader);
    const count = counts.get(ip) ?? 0;
    if (count >= options.perIp || total >= options.global) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((windowStart + WINDOW_MS - currentTime) / 1000)),
      };
    }
    if (active >= options.maxConcurrent) {
      return { allowed: false, retryAfterSeconds: 1 };
    }

    counts.set(ip, count + 1);
    total += 1;
    active += 1;
    let released = false;
    return {
      allowed: true,
      release: () => {
        if (!released) {
          active -= 1;
          released = true;
        }
      },
    };
  };
}

function getClientIp(request: IncomingMessage, trustProxyHeader: boolean): string {
  const proxyIp = request.headers?.['x-fresh-drop-client-ip'];
  const ip = trustProxyHeader && typeof proxyIp === 'string' && isIP(proxyIp)
    ? proxyIp
    : request.socket?.remoteAddress ?? 'unknown';
  return ip.startsWith('::ffff:') && isIP(ip.slice(7)) === 4 ? ip.slice(7) : ip;
}

function readPositiveInteger(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}
