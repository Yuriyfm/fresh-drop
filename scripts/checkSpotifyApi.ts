import { readFileSync } from 'node:fs';
import process from 'node:process';
import { SpotifyApiAdapter } from '../src/spotify/spotifyApiAdapter';
import { getReleaseSyncConfigFromEnv, type SyncEnv } from '../src/sync/syncConfig';

const SAMPLE_SIZE = 8;
const DAY_IN_MS = 24 * 60 * 60 * 1000;

async function main(): Promise<void> {
  const env = {
    ...process.env,
    ...readDotEnv('.env'),
  };
  const config = getReleaseSyncConfigFromEnv(env);
  const adapter = new SpotifyApiAdapter(config.spotify);
  const releases = await adapter.fetchFreshReleasesFromSpotify(config.fetchOptions);

  console.info(JSON.stringify({
    market: config.fetchOptions.market,
    limit: config.fetchOptions.limit,
    count: releases.length,
    stats: buildStats(releases),
    sample: releases.slice(0, SAMPLE_SIZE).map((release) => ({
      title: release.title,
      artists: release.artists.map((artist) => artist.name),
      type: release.type,
      releaseDate: release.releaseDate,
      precision: release.releaseDatePrecision,
      country: release.country,
      popularity: release.popularity,
      genres: release.genres.slice(0, 5),
      spotifyUrl: release.spotifyUrl,
    })),
  }, null, 2));
}

function buildStats(releases: Awaited<ReturnType<SpotifyApiAdapter['fetchFreshReleasesFromSpotify']>>) {
  const now = startOfUtcDay(new Date());
  const dayPrecisionReleases = releases.filter((release) => release.releaseDatePrecision === 'day');
  const releasesWithGenres = releases.filter((release) => release.genres.length > 0);
  const releasesWithPopularity = releases.filter((release) => release.popularity !== null);

  return {
    types: countBy(releases.map((release) => release.type)),
    releaseDatePrecision: countBy(releases.map((release) => release.releaseDatePrecision)),
    withGenres: releasesWithGenres.length,
    withPopularity: releasesWithPopularity.length,
    within7Days: countWithinDays(dayPrecisionReleases, now, 7),
    within14Days: countWithinDays(dayPrecisionReleases, now, 14),
    within30Days: countWithinDays(dayPrecisionReleases, now, 30),
    oldestDayPrecisionReleaseDate: getOldestReleaseDate(dayPrecisionReleases),
    newestDayPrecisionReleaseDate: getNewestReleaseDate(dayPrecisionReleases),
  };
}

function countBy(values: string[]): Record<string, number> {
  return values.reduce<Record<string, number>>((counts, value) => {
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}

function countWithinDays(
  releases: Awaited<ReturnType<SpotifyApiAdapter['fetchFreshReleasesFromSpotify']>>,
  currentDate: Date,
  days: number,
): number {
  const cutoff = currentDate.getTime() - days * DAY_IN_MS;

  return releases.filter((release) => {
    const releaseDate = Date.parse(`${release.releaseDate}T00:00:00.000Z`);
    return !Number.isNaN(releaseDate) && releaseDate >= cutoff && releaseDate <= currentDate.getTime();
  }).length;
}

function getOldestReleaseDate(releases: Awaited<ReturnType<SpotifyApiAdapter['fetchFreshReleasesFromSpotify']>>): string | null {
  return releases.map((release) => release.releaseDate).sort()[0] ?? null;
}

function getNewestReleaseDate(releases: Awaited<ReturnType<SpotifyApiAdapter['fetchFreshReleasesFromSpotify']>>): string | null {
  const dates = releases.map((release) => release.releaseDate).sort();

  return dates[dates.length - 1] ?? null;
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function readDotEnv(path: string): SyncEnv {
  const values: SyncEnv = {};
  let content = '';

  try {
    content = readFileSync(path, 'utf8');
  } catch {
    return values;
  }

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmed.indexOf('=');

    if (separatorIndex === -1) {
      continue;
    }

    values[trimmed.slice(0, separatorIndex)] = trimmed.slice(separatorIndex + 1);
  }

  return values;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Spotify API check failed.');
  process.exitCode = 1;
});
