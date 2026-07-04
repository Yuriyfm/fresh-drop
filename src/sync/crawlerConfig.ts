import type { SearchShardSeed } from './searchShard';
import { createDefaultSearchShardSeeds, parseSearchShardSeeds } from './searchShard';

export type CrawlerEnv = Record<string, string | undefined>;

export type ReleaseCrawlerConfig = {
  market: string;
  batchSize: number;
  searchLimit: number;
  artistAlbumsLimit: number;
  retentionDays: number;
  searchSeeds: SearchShardSeed[];
  enableArtistExpansion: boolean;
  searchTaskCooldownMinutes: number;
  maxShardDepth: number;
  maxSafeOffset: number;
};

const DEFAULT_MARKET = 'US';
const DEFAULT_BATCH_SIZE = 5;
const DEFAULT_SEARCH_LIMIT = 50;
const DEFAULT_ARTIST_ALBUMS_LIMIT = 10;
const DEFAULT_RETENTION_DAYS = 30;
const DEFAULT_MAX_SHARD_DEPTH = 4;
const DEFAULT_MAX_SAFE_OFFSET = 950;

export function getReleaseCrawlerConfigFromEnv(env: CrawlerEnv, currentDate = new Date()): ReleaseCrawlerConfig {
  return {
    market: normalizeMarket(env.SPOTIFY_MARKET),
    batchSize: normalizePositiveInteger(env.SPOTIFY_CRAWLER_BATCH_SIZE, DEFAULT_BATCH_SIZE, 100),
    searchLimit: normalizePositiveInteger(env.SPOTIFY_CRAWLER_SEARCH_LIMIT ?? env.SPOTIFY_SYNC_LIMIT, DEFAULT_SEARCH_LIMIT, 50),
    artistAlbumsLimit: normalizePositiveInteger(env.SPOTIFY_CRAWLER_ARTIST_ALBUMS_LIMIT, DEFAULT_ARTIST_ALBUMS_LIMIT, 10),
    retentionDays: normalizePositiveInteger(env.RELEASE_RETENTION_DAYS, DEFAULT_RETENTION_DAYS, 365),
    searchSeeds: normalizeSearchSeeds(env.SPOTIFY_CRAWLER_SEARCH_QUERIES, currentDate),
    enableArtistExpansion: normalizeBoolean(env.SPOTIFY_CRAWLER_ENABLE_ARTIST_EXPANSION, false),
    searchTaskCooldownMinutes: normalizePositiveInteger(env.SPOTIFY_CRAWLER_SEARCH_TASK_COOLDOWN_MINUTES, 360, 10080),
    maxShardDepth: normalizePositiveInteger(env.SPOTIFY_CRAWLER_MAX_SHARD_DEPTH, DEFAULT_MAX_SHARD_DEPTH, 8),
    maxSafeOffset: normalizePositiveInteger(env.SPOTIFY_CRAWLER_MAX_SAFE_OFFSET, DEFAULT_MAX_SAFE_OFFSET, 1000),
  };
}

function normalizeMarket(value: string | undefined): string {
  const market = value?.trim().toUpperCase();

  return market || DEFAULT_MARKET;
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

function normalizeSearchSeeds(value: string | undefined, _currentDate: Date): SearchShardSeed[] {
  if (value?.trim()) {
    return parseSearchShardSeeds(value);
  }

  return createDefaultSearchShardSeeds();
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
