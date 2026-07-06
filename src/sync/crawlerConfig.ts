import type { SearchShardSeed } from './searchShard';
import { createDefaultSearchShardSeeds, parseSearchShardSeeds } from './searchShard';

export type CrawlerEnv = Record<string, string | undefined>;

export type ReleaseCrawlerConfig = {
  markets: string[];
  batchSize: number;
  searchLimit: number;
  artistAlbumsLimit: number;
  retentionDays: number;
  searchSeeds: SearchShardSeed[];
  enableArtistExpansion: boolean;
  searchTaskCooldownMinutes: number;
  maxShardDepth: number;
  maxSafeOffset: number;
  splitTotalThreshold: number;
  artistCacheTtlDays: number;
};

const DEFAULT_MARKET = 'US';
const DEFAULT_BATCH_SIZE = 5;
const DEFAULT_SEARCH_LIMIT = 10;
const DEFAULT_ARTIST_ALBUMS_LIMIT = 10;
const DEFAULT_RETENTION_DAYS = 30;
const DEFAULT_MAX_SHARD_DEPTH = 4;
const DEFAULT_MAX_SAFE_OFFSET = 1000;
const DEFAULT_SPLIT_TOTAL_THRESHOLD = 800;
const DEFAULT_ARTIST_CACHE_TTL_DAYS = 30;

export function getReleaseCrawlerConfigFromEnv(env: CrawlerEnv, currentDate = new Date()): ReleaseCrawlerConfig {
  const markets = normalizeMarkets(env.SPOTIFY_MARKETS, env.SPOTIFY_MARKET);

  return {
    markets,
    batchSize: normalizePositiveInteger(env.SPOTIFY_CRAWLER_BATCH_SIZE, DEFAULT_BATCH_SIZE, 100),
    searchLimit: normalizePositiveInteger(
      env.SPOTIFY_SEARCH_LIMIT ?? env.SPOTIFY_CRAWLER_SEARCH_LIMIT ?? env.SPOTIFY_SYNC_LIMIT,
      DEFAULT_SEARCH_LIMIT,
      50,
    ),
    artistAlbumsLimit: normalizePositiveInteger(env.SPOTIFY_CRAWLER_ARTIST_ALBUMS_LIMIT, DEFAULT_ARTIST_ALBUMS_LIMIT, 10),
    retentionDays: normalizePositiveInteger(env.RELEASE_RETENTION_DAYS, DEFAULT_RETENTION_DAYS, 365),
    searchSeeds: normalizeSearchSeeds(env.SPOTIFY_CRAWLER_SEARCH_QUERIES, markets, currentDate),
    enableArtistExpansion: normalizeBoolean(env.SPOTIFY_CRAWLER_ENABLE_ARTIST_EXPANSION, false),
    searchTaskCooldownMinutes: normalizePositiveInteger(env.SPOTIFY_CRAWLER_SEARCH_TASK_COOLDOWN_MINUTES, 360, 10080),
    maxShardDepth: normalizePositiveInteger(env.SPOTIFY_CRAWLER_MAX_SHARD_DEPTH, DEFAULT_MAX_SHARD_DEPTH, 8),
    maxSafeOffset: normalizePositiveInteger(
      env.SPOTIFY_MAX_SAFE_OFFSET ?? env.SPOTIFY_CRAWLER_MAX_SAFE_OFFSET,
      DEFAULT_MAX_SAFE_OFFSET,
      1000,
    ),
    splitTotalThreshold: normalizePositiveInteger(env.SPOTIFY_SPLIT_TOTAL_THRESHOLD, DEFAULT_SPLIT_TOTAL_THRESHOLD, 1000),
    artistCacheTtlDays: normalizePositiveInteger(env.SPOTIFY_ARTIST_CACHE_TTL_DAYS, DEFAULT_ARTIST_CACHE_TTL_DAYS, 365),
  };
}

function normalizeMarkets(marketsValue: string | undefined, marketValue: string | undefined): string[] {
  const values = (marketsValue ?? marketValue ?? DEFAULT_MARKET)
    .split(',')
    .map((value) => value.trim().toUpperCase())
    .filter((value) => value.length > 0);

  if (values.length === 0) {
    return [DEFAULT_MARKET];
  }

  return Array.from(new Set(values));
}

function normalizePositiveInteger(value: string | undefined, defaultValue: number, max: number): number {
  if (!value) {
    return defaultValue;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error('Crawler numeric env values must be positive integers.');
  }

  return Math.min(parsed, max);
}

function normalizeSearchSeeds(value: string | undefined, markets: string[], _currentDate: Date): SearchShardSeed[] {
  if (value?.trim()) {
    return parseSearchShardSeeds(value);
  }

  return createDefaultSearchShardSeeds(markets);
}

function normalizeBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (!value) {
    return defaultValue;
  }

  const normalized = value.trim().toLowerCase();

  if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
    return true;
  }

  if (normalized === 'false' || normalized === '0' || normalized === 'no') {
    return false;
  }

  throw new Error('Crawler boolean env values must be true or false.');
}
