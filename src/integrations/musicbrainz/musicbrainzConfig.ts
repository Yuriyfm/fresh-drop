export type MusicBrainzEnv = Record<string, string | undefined>;

export type MusicBrainzConfig = {
  enabled: boolean;
  baseUrl: string;
  userAgent: string;
  rateLimitMs: number;
  urlLookupBatchSize: number;
  requestTimeoutMs: number;
};

const DEFAULT_ENABLED = false;
const DEFAULT_BASE_URL = 'https://musicbrainz.org/ws/2';
const DEFAULT_RATE_LIMIT_MS = 1100;
const DEFAULT_URL_LOOKUP_BATCH_SIZE = 100;
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

export function getMusicBrainzConfigFromEnv(env: MusicBrainzEnv): MusicBrainzConfig {
  const enabled = normalizeBoolean(env.MUSICBRAINZ_ENABLED, DEFAULT_ENABLED);
  const userAgent = env.MUSICBRAINZ_USER_AGENT?.trim() ?? '';

  if (enabled && userAgent.length === 0) {
    throw new Error('MUSICBRAINZ_USER_AGENT is required when MUSICBRAINZ_ENABLED=true.');
  }

  return {
    enabled,
    baseUrl: normalizeBaseUrl(env.MUSICBRAINZ_BASE_URL),
    userAgent,
    rateLimitMs: normalizePositiveInteger(env.MUSICBRAINZ_RATE_LIMIT_MS, DEFAULT_RATE_LIMIT_MS, 'MUSICBRAINZ_RATE_LIMIT_MS'),
    urlLookupBatchSize: normalizePositiveInteger(
      env.MUSICBRAINZ_URL_LOOKUP_BATCH_SIZE,
      DEFAULT_URL_LOOKUP_BATCH_SIZE,
      'MUSICBRAINZ_URL_LOOKUP_BATCH_SIZE',
      100,
    ),
    requestTimeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
  };
}

function normalizeBaseUrl(value: string | undefined): string {
  const normalized = value?.trim() || DEFAULT_BASE_URL;

  return normalized.replace(/\/+$/, '');
}

function normalizeBoolean(value: string | undefined, fallback: boolean): boolean {
  if (!value) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();

  if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
    return true;
  }

  if (normalized === 'false' || normalized === '0' || normalized === 'no') {
    return false;
  }

  throw new Error('MUSICBRAINZ_ENABLED must be true or false.');
}

function normalizePositiveInteger(value: string | undefined, fallback: number, name: string, max?: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }

  return max === undefined ? parsed : Math.min(parsed, max);
}
