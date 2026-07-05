import { describe, expect, it } from 'vitest';
import { getMusicBrainzConfigFromEnv } from './musicbrainzConfig';

describe('getMusicBrainzConfigFromEnv', () => {
  it('reads MusicBrainz config from env', () => {
    expect(getMusicBrainzConfigFromEnv({
      MUSICBRAINZ_ENABLED: 'true',
      MUSICBRAINZ_BASE_URL: 'https://musicbrainz.org/ws/2/',
      MUSICBRAINZ_USER_AGENT: 'FreshDrop/0.1.0 (test@example.com)',
      MUSICBRAINZ_RATE_LIMIT_MS: '1500',
      MUSICBRAINZ_URL_LOOKUP_BATCH_SIZE: '20',
    })).toEqual({
      enabled: true,
      baseUrl: 'https://musicbrainz.org/ws/2',
      userAgent: 'FreshDrop/0.1.0 (test@example.com)',
      rateLimitMs: 1500,
      urlLookupBatchSize: 20,
      requestTimeoutMs: 15000,
    });
  });

  it('requires a user agent when enabled', () => {
    expect(() => getMusicBrainzConfigFromEnv({
      MUSICBRAINZ_ENABLED: 'true',
    })).toThrow('MUSICBRAINZ_USER_AGENT is required');
  });
});
