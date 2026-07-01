import type { PopularityFilter, Release, ReleaseFilters, ReleasePeriod, ReleaseTypeFilter } from './release';

const millisecondsInDay = 24 * 60 * 60 * 1000;

export function filterReleases(releases: Release[], filters: ReleaseFilters): Release[] {
  return releases.filter((release) => {
    return (
      matchesPeriod(release, filters.period, filters.currentDate) &&
      matchesGenre(release, filters.genre) &&
      matchesCountry(release, filters.country) &&
      matchesType(release, filters.type) &&
      matchesPopularity(release, filters.popularity)
    );
  });
}

export function matchesPeriod(release: Release, period: ReleasePeriod, currentDate: Date): boolean {
  if (release.releaseDatePrecision !== 'day') {
    return false;
  }

  const releaseDate = parseDateOnly(release.releaseDate);

  if (!releaseDate) {
    return false;
  }

  const currentDay = startOfUtcDay(currentDate);
  const releaseDay = startOfUtcDay(releaseDate);
  const ageInDays = Math.floor((currentDay.getTime() - releaseDay.getTime()) / millisecondsInDay);

  if (ageInDays < 0) {
    return false;
  }

  return ageInDays <= getPeriodDays(period);
}

export function matchesGenre(release: Release, genre?: string): boolean {
  const normalizedGenre = normalizeTextFilter(genre);

  if (!normalizedGenre) {
    return true;
  }

  return release.genres.some((releaseGenre) => normalizeTextFilter(releaseGenre) === normalizedGenre);
}

export function matchesCountry(release: Release, country?: string): boolean {
  const normalizedCountry = normalizeTextFilter(country);

  if (!normalizedCountry) {
    return true;
  }

  return normalizeTextFilter(release.country) === normalizedCountry;
}

export function matchesType(release: Release, type: ReleaseTypeFilter): boolean {
  return type === 'all' || release.type === type;
}

export function matchesPopularity(release: Release, popularity: PopularityFilter): boolean {
  if (popularity === 'all') {
    return true;
  }

  if (release.popularity === null) {
    return popularity === 'less-known';
  }

  if (popularity === 'popular') {
    return release.popularity >= 60;
  }

  return release.popularity < 60;
}

function getPeriodDays(period: ReleasePeriod): number {
  if (period === '7d') {
    return 7;
  }

  if (period === '14d') {
    return 14;
  }

  return 31;
}

function parseDateOnly(value: string): Date | null {
  const date = new Date(`${value}T00:00:00.000Z`);

  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function normalizeTextFilter(value?: string): string {
  return value?.trim().toLowerCase() ?? '';
}
