export type CrawlerEnv = Record<string, string | undefined>;

export type ReleaseCrawlerConfig = {
  market: string;
  batchSize: number;
  searchLimit: number;
  artistAlbumsLimit: number;
  retentionDays: number;
  searchQueries: string[];
  enableArtistExpansion: boolean;
  searchTaskCooldownMinutes: number;
};

const DEFAULT_MARKET = 'US';
const DEFAULT_BATCH_SIZE = 20;
const DEFAULT_SEARCH_LIMIT = 50;
const DEFAULT_ARTIST_ALBUMS_LIMIT = 10;
const DEFAULT_RETENTION_DAYS = 30;

export function getReleaseCrawlerConfigFromEnv(env: CrawlerEnv, currentDate = new Date()): ReleaseCrawlerConfig {
  return {
    market: normalizeMarket(env.SPOTIFY_MARKET),
    batchSize: normalizePositiveInteger(env.SPOTIFY_CRAWLER_BATCH_SIZE, DEFAULT_BATCH_SIZE, 200),
    searchLimit: normalizePositiveInteger(env.SPOTIFY_CRAWLER_SEARCH_LIMIT ?? env.SPOTIFY_SYNC_LIMIT, DEFAULT_SEARCH_LIMIT, 50),
    artistAlbumsLimit: normalizePositiveInteger(env.SPOTIFY_CRAWLER_ARTIST_ALBUMS_LIMIT, DEFAULT_ARTIST_ALBUMS_LIMIT, 10),
    retentionDays: normalizePositiveInteger(env.RELEASE_RETENTION_DAYS, DEFAULT_RETENTION_DAYS, 365),
    searchQueries: normalizeSearchQueries(env.SPOTIFY_CRAWLER_SEARCH_QUERIES, currentDate),
    enableArtistExpansion: normalizeBoolean(env.SPOTIFY_CRAWLER_ENABLE_ARTIST_EXPANSION, false),
    searchTaskCooldownMinutes: normalizePositiveInteger(env.SPOTIFY_CRAWLER_SEARCH_TASK_COOLDOWN_MINUTES, 720, 10080),
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

function normalizeSearchQueries(value: string | undefined, currentDate: Date): string[] {
  if (value?.trim()) {
    return Array.from(new Set(value.split(',').map((query) => query.trim()).filter(Boolean)));
  }

  const year = currentDate.getUTCFullYear();
  const shards = 'abcdefghijklmnopqrstuvwxyz0123456789'.split('').map((term) => `${term} year:${year}`);

  return ['tag:new', ...shards];
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
