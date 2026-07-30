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

  it('requires a real contact in the user agent', () => {
    expect(() => getMusicBrainzConfigFromEnv({
      MUSICBRAINZ_ENABLED: 'true',
      MUSICBRAINZ_USER_AGENT: 'FreshDrop/0.1.0 (your-email@example.com)',
    })).toThrow('must include a contact URL or email');
  });

  it('rejects a request interval faster than the public rate limit', () => {
    expect(() => getMusicBrainzConfigFromEnv({
      MUSICBRAINZ_ENABLED: 'true',
      MUSICBRAINZ_USER_AGENT: 'FreshDrop/0.1.0 (https://github.com/Yuriyfm/fresh-drop)',
      MUSICBRAINZ_RATE_LIMIT_MS: '999',
    })).toThrow('must be at least 1000');
  });
});
