import { describe, expect, it } from 'vitest';
import { getReleaseSyncConfigFromEnv } from './syncConfig';

describe('getReleaseSyncConfigFromEnv', () => {
  it('reads Spotify credentials and sync options from env', () => {
    expect(
      getReleaseSyncConfigFromEnv({
        SPOTIFY_CLIENT_ID: 'client-id',
        SPOTIFY_CLIENT_SECRET: 'client-secret',
        SPOTIFY_MARKET: 'de',
        SPOTIFY_SYNC_LIMIT: '25',
        SPOTIFY_SYNC_PAGES: '3',
      }),
    ).toEqual({
      spotify: {
        clientId: 'client-id',
        clientSecret: 'client-secret',
        minRequestIntervalMs: 10000,
      },
      fetchOptions: {
        market: 'DE',
        limit: 25,
        pages: 3,
      },
    });
  });

  it('uses safe defaults for market and limit', () => {
    expect(
      getReleaseSyncConfigFromEnv({
        SPOTIFY_CLIENT_ID: 'client-id',
        SPOTIFY_CLIENT_SECRET: 'client-secret',
      }).fetchOptions,
    ).toEqual({
      market: 'US',
      limit: 50,
      pages: 1,
    });
    expect(
      getReleaseSyncConfigFromEnv({
        SPOTIFY_CLIENT_ID: 'client-id',
        SPOTIFY_CLIENT_SECRET: 'client-secret',
      }).spotify.minRequestIntervalMs,
    ).toBe(10000);
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

  it('reads and validates the Spotify request interval', () => {
    expect(
      getReleaseSyncConfigFromEnv({
        SPOTIFY_CLIENT_ID: 'client-id',
        SPOTIFY_CLIENT_SECRET: 'client-secret',
        SPOTIFY_API_MIN_REQUEST_INTERVAL_MS: '1500',
      }).spotify.minRequestIntervalMs,
    ).toBe(1500);

    expect(
      getReleaseSyncConfigFromEnv({
        SPOTIFY_CLIENT_ID: 'client-id',
        SPOTIFY_CLIENT_SECRET: 'client-secret',
        SPOTIFY_API_MIN_REQUEST_INTERVAL_MS: '999999',
      }).spotify.minRequestIntervalMs,
    ).toBe(60000);

    expect(() =>
      getReleaseSyncConfigFromEnv({
        SPOTIFY_CLIENT_ID: 'client-id',
        SPOTIFY_CLIENT_SECRET: 'client-secret',
        SPOTIFY_API_MIN_REQUEST_INTERVAL_MS: '-1',
      }),
    ).toThrow('SPOTIFY_API_MIN_REQUEST_INTERVAL_MS must be a non-negative integer.');
  });
});
