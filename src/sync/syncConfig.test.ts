import { describe, expect, it } from 'vitest';
import { getReleaseSyncConfigFromEnv } from './syncConfig';

describe('getReleaseSyncConfigFromEnv', () => {
  it('reads Spotify credentials, sync options, and adaptive scheduler settings from env', () => {
    expect(
      getReleaseSyncConfigFromEnv({
        SPOTIFY_CLIENT_ID: 'client-id',
        SPOTIFY_CLIENT_SECRET: 'client-secret',
        SPOTIFY_MARKET: 'de',
        SPOTIFY_SYNC_LIMIT: '25',
        SPOTIFY_SYNC_PAGES: '3',
        SPOTIFY_INITIAL_RPS: '1.5',
        SPOTIFY_MAX_RPS: '3',
        SPOTIFY_MIN_RPS: '0.2',
        SPOTIFY_MAX_CONCURRENCY: '2',
        SPOTIFY_RATE_INCREASE_STEP: '0.3',
        SPOTIFY_RATE_DECREASE_FACTOR: '0.4',
        SPOTIFY_RATE_STABLE_WINDOW_MS: '600000',
        SPOTIFY_RETRY_JITTER_MS: '750',
      }),
    ).toEqual({
      spotify: {
        clientId: 'client-id',
        clientSecret: 'client-secret',
        requestSchedulerConfig: {
          initialRps: 1.5,
          maxRps: 3,
          minRps: 0.2,
          maxConcurrency: 2,
          rateIncreaseStep: 0.3,
          rateDecreaseFactor: 0.4,
          stableWindowMs: 600000,
          retryJitterMs: 750,
        },
      },
      fetchOptions: {
        market: 'DE',
        limit: 25,
        pages: 3,
      },
    });
  });

  it('uses adaptive defaults for Spotify requests', () => {
    expect(
      getReleaseSyncConfigFromEnv({
        SPOTIFY_CLIENT_ID: 'client-id',
        SPOTIFY_CLIENT_SECRET: 'client-secret',
      }),
    ).toEqual({
      spotify: {
        clientId: 'client-id',
        clientSecret: 'client-secret',
        requestSchedulerConfig: {
          initialRps: 1,
          maxRps: 2,
          minRps: 0.1,
          maxConcurrency: 1,
          rateIncreaseStep: 0.2,
          rateDecreaseFactor: 0.5,
          stableWindowMs: 300000,
          retryJitterMs: 500,
        },
      },
      fetchOptions: {
        market: 'US',
        limit: 50,
        pages: 1,
      },
    });
  });

  it('requires Spotify credentials', () => {
    expect(() => getReleaseSyncConfigFromEnv({ SPOTIFY_CLIENT_SECRET: 'client-secret' })).toThrow(
      'SPOTIFY_CLIENT_ID is required',
    );
    expect(() => getReleaseSyncConfigFromEnv({ SPOTIFY_CLIENT_ID: 'client-id' })).toThrow(
      'SPOTIFY_CLIENT_SECRET is required',
    );
  });

  it('validates and clamps the sync limit', () => {
    expect(
      getReleaseSyncConfigFromEnv({
        SPOTIFY_CLIENT_ID: 'client-id',
        SPOTIFY_CLIENT_SECRET: 'client-secret',
        SPOTIFY_SYNC_LIMIT: '500',
      }).fetchOptions.limit,
    ).toBe(50);
    expect(() =>
      getReleaseSyncConfigFromEnv({
        SPOTIFY_CLIENT_ID: 'client-id',
        SPOTIFY_CLIENT_SECRET: 'client-secret',
        SPOTIFY_SYNC_LIMIT: '0',
      }),
    ).toThrow('SPOTIFY_SYNC_LIMIT must be a positive integer.');
  });

  it('validates and clamps sync pages', () => {
    expect(
      getReleaseSyncConfigFromEnv({
        SPOTIFY_CLIENT_ID: 'client-id',
        SPOTIFY_CLIENT_SECRET: 'client-secret',
        SPOTIFY_SYNC_PAGES: '500',
      }).fetchOptions.pages,
    ).toBe(10);
    expect(() =>
      getReleaseSyncConfigFromEnv({
        SPOTIFY_CLIENT_ID: 'client-id',
        SPOTIFY_CLIENT_SECRET: 'client-secret',
        SPOTIFY_SYNC_PAGES: '0',
      }),
    ).toThrow('SPOTIFY_SYNC_PAGES must be a positive integer.');
  });

  it('validates scheduler env values', () => {
    expect(() =>
      getReleaseSyncConfigFromEnv({
        SPOTIFY_CLIENT_ID: 'client-id',
        SPOTIFY_CLIENT_SECRET: 'client-secret',
        SPOTIFY_INITIAL_RPS: '0',
      }),
    ).toThrow('SPOTIFY_INITIAL_RPS must be a positive number.');

    expect(() =>
      getReleaseSyncConfigFromEnv({
        SPOTIFY_CLIENT_ID: 'client-id',
        SPOTIFY_CLIENT_SECRET: 'client-secret',
        SPOTIFY_RATE_DECREASE_FACTOR: '2',
      }),
    ).toThrow('SPOTIFY_RATE_DECREASE_FACTOR must be greater than 0 and at most 1.');
  });
});
