import type { IncomingMessage } from 'node:http';
import { describe, expect, it } from 'vitest';
import { createApiRateLimiter, getApiRateLimitOptions, type ApiAdmission } from './apiRateLimiter';

const limits = { perIp: 2, global: 3, maxConcurrent: 2, trustProxyHeader: false };

describe('API rate limiter', () => {
  it('limits each IP, normalizes mapped IPv4, and ignores untrusted headers', () => {
    const admit = createApiRateLimiter(limits);
    release(admit(request('192.0.2.1')));
    release(admit(request('::ffff:192.0.2.1')));
    expect(admit(request('192.0.2.1', { 'x-forwarded-for': '192.0.2.2', 'x-fresh-drop-client-ip': '192.0.2.2' })))
      .toEqual({ allowed: false, retryAfterSeconds: 60 });
    expect(admit(request('192.0.2.2')).allowed).toBe(true);
  });

  it('enforces a global limit across IPs without counting per-IP rejections', () => {
    const admit = createApiRateLimiter(limits);
    release(admit(request('192.0.2.1')));
    release(admit(request('192.0.2.1')));
    expect(admit(request('192.0.2.1')).allowed).toBe(false);
    release(admit(request('192.0.2.2')));
    expect(admit(request('192.0.2.3')).allowed).toBe(false);
  });

  it('resets IP and global counters at the window boundary with a rounded Retry-After', () => {
    let time = 0;
    const admit = createApiRateLimiter(limits, () => time);
    release(admit(request('192.0.2.1')));
    release(admit(request('192.0.2.1')));
    release(admit(request('192.0.2.2')));
    time = 59_001;
    expect(admit(request('192.0.2.1'))).toEqual({ allowed: false, retryAfterSeconds: 1 });
    time = 60_000;
    expect(admit(request('192.0.2.1')).allowed).toBe(true);
  });

  it('bounds concurrency across window resets and releases each slot only once', () => {
    let time = 0;
    const admit = createApiRateLimiter(limits, () => time);
    const first = admit(request('192.0.2.1'));
    const second = admit(request('192.0.2.2'));
    time = 60_000;
    expect(admit(request('192.0.2.3'))).toEqual({ allowed: false, retryAfterSeconds: 1 });
    release(first);
    release(first);
    expect(admit(request('192.0.2.3')).allowed).toBe(true);
    expect(admit(request('192.0.2.4')).allowed).toBe(false);
    release(second);
    expect(admit(request('192.0.2.4')).allowed).toBe(true);
  });

  it('uses only a valid proxy header when explicitly trusted, with socket fallback', () => {
    const admit = createApiRateLimiter({ ...limits, perIp: 1, global: 10, trustProxyHeader: true });
    release(admit(request('172.18.0.2', { 'x-fresh-drop-client-ip': '2001:db8::1' })));
    release(admit(request('172.18.0.2', { 'x-fresh-drop-client-ip': '2001:db8::2' })));
    expect(admit(request('172.18.0.2', { 'x-fresh-drop-client-ip': '2001:db8::1' })).allowed).toBe(false);
    release(admit(request('172.18.0.2', { 'x-fresh-drop-client-ip': 'invalid' })));
    expect(admit(request('172.18.0.2', { 'x-fresh-drop-client-ip': ['192.0.2.1', '192.0.2.2'] })).allowed).toBe(false);
  });

  it('loads conservative defaults and explicit environment overrides', () => {
    expect(getApiRateLimitOptions({})).toEqual({
      perIp: 60, global: 300, maxConcurrent: 8, trustProxyHeader: false,
    });
    expect(getApiRateLimitOptions({
      API_RATE_LIMIT_PER_IP: '20', API_RATE_LIMIT_GLOBAL: '100',
      API_MAX_CONCURRENT_REQUESTS: '4', API_TRUST_PROXY_HEADER: 'true',
    })).toEqual({ perIp: 20, global: 100, maxConcurrent: 4, trustProxyHeader: true });
  });

  it.each(['0', '-1', '1.5', '', 'abc', 'Infinity', '9007199254740992'])('rejects invalid limit %j', (value) => {
    for (const key of ['API_RATE_LIMIT_PER_IP', 'API_RATE_LIMIT_GLOBAL', 'API_MAX_CONCURRENT_REQUESTS']) {
      expect(() => getApiRateLimitOptions({ [key]: value })).toThrow(`${key} must be a positive integer.`);
    }
  });
});

function request(ip: string, headers: IncomingMessage['headers'] = {}): IncomingMessage {
  return { socket: { remoteAddress: ip }, headers } as IncomingMessage;
}

function release(admission: ApiAdmission): void {
  expect(admission.allowed).toBe(true);
  if (admission.allowed) admission.release();
}
