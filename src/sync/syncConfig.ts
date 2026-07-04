import type { FetchFreshReleasesFromSpotifyOptions, SpotifyApiAdapterConfig } from '../spotify/spotifyApiAdapter';

export type SyncEnv = Record<string, string | undefined>;

export type ReleaseSyncConfig = {
  spotify: SpotifyApiAdapterConfig;
  fetchOptions: Required<FetchFreshReleasesFromSpotifyOptions>;
};

const DEFAULT_MARKET = 'US';
const DEFAULT_LIMIT = 50;
const DEFAULT_PAGES = 1;
const MAX_LIMIT = 50;
const MAX_PAGES = 10;
const DEFAULT_MIN_REQUEST_INTERVAL_MS = 10_000;
const MAX_MIN_REQUEST_INTERVAL_MS = 60_000;

export function getReleaseSyncConfigFromEnv(env: SyncEnv): ReleaseSyncConfig {
  const clientId = getRequiredEnv(env, 'SPOTIFY_CLIENT_ID');
  const clientSecret = getRequiredEnv(env, 'SPOTIFY_CLIENT_SECRET');

  return {
    spotify: {
      clientId,
      clientSecret,
      minRequestIntervalMs: normalizeMinRequestIntervalMs(env.SPOTIFY_API_MIN_REQUEST_INTERVAL_MS),
    },
    fetchOptions: {
      market: normalizeMarket(env.SPOTIFY_MARKET),
      limit: normalizeLimit(env.SPOTIFY_SYNC_LIMIT),
      pages: normalizePages(env.SPOTIFY_SYNC_PAGES),
    },
  };
}

function getRequiredEnv(env: SyncEnv, name: string): string {
  const value = env[name]?.trim();

  if (!value) {
    throw new Error(`${name} is required for release sync.`);
  }

  return value;
}

function normalizeMarket(value: string | undefined): string {
  const market = value?.trim().toUpperCase();

  return market || DEFAULT_MARKET;
}

function normalizeLimit(value: string | undefined): number {
  if (!value) {
    return DEFAULT_LIMIT;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error('SPOTIFY_SYNC_LIMIT must be a positive integer.');
  }

  return Math.min(parsed, MAX_LIMIT);
}

function normalizePages(value: string | undefined): number {
  if (!value) {
    return DEFAULT_PAGES;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error('SPOTIFY_SYNC_PAGES must be a positive integer.');
  }

  return Math.min(parsed, MAX_PAGES);
}

function normalizeMinRequestIntervalMs(value: string | undefined): number {
  if (!value) {
    return DEFAULT_MIN_REQUEST_INTERVAL_MS;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error('SPOTIFY_API_MIN_REQUEST_INTERVAL_MS must be a non-negative integer.');
  }

  return Math.min(parsed, MAX_MIN_REQUEST_INTERVAL_MS);
}
