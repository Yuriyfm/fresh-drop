import type { FetchFreshReleasesFromSpotifyOptions, SpotifyApiAdapterConfig } from '../spotify/spotifyApiAdapter';
import type { SpotifyRequestSchedulerConfig } from '../spotify/spotifyRequestScheduler';

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

export function getReleaseSyncConfigFromEnv(env: SyncEnv): ReleaseSyncConfig {
  const clientId = getRequiredEnv(env, 'SPOTIFY_CLIENT_ID');
  const clientSecret = getRequiredEnv(env, 'SPOTIFY_CLIENT_SECRET');

  return {
    spotify: {
      clientId,
      clientSecret,
      requestSchedulerConfig: getSpotifyRequestSchedulerConfigFromEnv(env),
    },
    fetchOptions: {
      market: normalizeMarket(env.SPOTIFY_MARKET),
      limit: normalizeLimit(env.SPOTIFY_SYNC_LIMIT),
      pages: normalizePages(env.SPOTIFY_SYNC_PAGES),
    },
  };
}

export function getSpotifyRequestSchedulerConfigFromEnv(env: SyncEnv): SpotifyRequestSchedulerConfig {
  return {
    initialRps: normalizePositiveNumber(env.SPOTIFY_INITIAL_RPS, 1, 'SPOTIFY_INITIAL_RPS'),
    maxRps: normalizePositiveNumber(env.SPOTIFY_MAX_RPS, 2, 'SPOTIFY_MAX_RPS'),
    minRps: normalizePositiveNumber(env.SPOTIFY_MIN_RPS, 0.1, 'SPOTIFY_MIN_RPS'),
    maxConcurrency: normalizePositiveInteger(env.SPOTIFY_MAX_CONCURRENCY, 1, 'SPOTIFY_MAX_CONCURRENCY'),
    rateIncreaseStep: normalizePositiveNumber(env.SPOTIFY_RATE_INCREASE_STEP, 0.2, 'SPOTIFY_RATE_INCREASE_STEP'),
    rateDecreaseFactor: normalizeFactor(env.SPOTIFY_RATE_DECREASE_FACTOR, 0.5, 'SPOTIFY_RATE_DECREASE_FACTOR'),
    stableWindowMs: normalizeNonNegativeInteger(env.SPOTIFY_RATE_STABLE_WINDOW_MS, 300_000, 'SPOTIFY_RATE_STABLE_WINDOW_MS'),
    retryJitterMs: normalizeNonNegativeInteger(env.SPOTIFY_RETRY_JITTER_MS, 500, 'SPOTIFY_RETRY_JITTER_MS'),
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

function normalizeNonNegativeInteger(value: string | undefined, fallback: number, name: string): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer.`);
  }

  return parsed;
}

function normalizePositiveInteger(value: string | undefined, fallback: number, name: string): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }

  return parsed;
}

function normalizePositiveNumber(value: string | undefined, fallback: number, name: string): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive number.`);
  }

  return parsed;
}

function normalizeFactor(value: string | undefined, fallback: number, name: string): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1) {
    throw new Error(`${name} must be greater than 0 and at most 1.`);
  }

  return parsed;
}
