import type { Release, ReleaseFilters, ReleasePeriod, ReleaseSort, ReleaseTypeFilter } from './release';
import { isNoGenreFilter, matchesGenreValue, normalizeGenreText } from './topLevelGenres';

const millisecondsInDay = 24 * 60 * 60 * 1000;

export function filterReleases(releases: Release[], filters: ReleaseFilters): Release[] {
  return releases.filter((release) => {
    return (
      matchesPeriod(release, filters.period, filters.currentDate) &&
      matchesGenres(release, filters.genres ?? toGenreArray(filters.genre)) &&
      matchesCountries(release, filters.countries ?? toCountryArray(filters.country)) &&
      matchesPopularity(release, filters.popularityMin, filters.popularityMax) &&
      matchesType(release, filters.type)
    );
  });
}

export function sortReleasesForSearch(releases: Release[], sort: ReleaseSort = 'newest'): Release[] {
  return [...releases].sort((left, right) => {
    if (sort === 'popular' || sort === 'less-popular') {
      const popularityComparison = comparePopularity(left.popularity, right.popularity, sort);

      if (popularityComparison !== 0) {
        return popularityComparison;
      }

      return left.id.localeCompare(right.id);
    }

    const dateComparison = compareReleaseDates(left, right, sort);

    if (dateComparison !== 0) {
      return dateComparison;
    }

    return left.id.localeCompare(right.id);
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
  return matchesGenres(release, toGenreArray(genre));
}

export function matchesGenres(release: Release, genres?: string[]): boolean {
  const normalizedGenres = normalizeGenreFilters(genres);

  if (normalizedGenres.length === 0) {
    return true;
  }

  const releaseGenres = release.genres.map(normalizeGenreText).filter(Boolean);

  return normalizedGenres.some((genre) => {
    if (isNoGenreFilter(genre)) {
      return releaseGenres.length === 0;
    }

    return releaseGenres.some((releaseGenre) => matchesGenreValue(releaseGenre, genre));
  });
}

export function matchesCountry(release: Release, country?: string): boolean {
  return matchesCountries(release, toCountryArray(country));
}

export function matchesCountries(release: Release, countries?: string[]): boolean {
  const normalizedCountries = normalizeTextFilters(countries);

  if (normalizedCountries.length === 0) {
    return true;
  }

  return normalizedCountries.includes(normalizeTextFilter(release.country));
}

export function matchesType(release: Release, type: ReleaseTypeFilter): boolean {
  return type === 'all' || release.type === type;
}

export function matchesPopularity(release: Release, min?: number, max?: number): boolean {
  if (min === undefined && max === undefined) {
    return true;
  }

  if (release.popularity === null) {
    return false;
  }

  if (min !== undefined && release.popularity < min) {
    return false;
  }

  return max === undefined || release.popularity <= max;
}

function getPeriodDays(period: ReleasePeriod): number {
  if (period === 'today') {
    return 0;
  }

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

function compareReleaseDates(left: Release, right: Release, sort: ReleaseSort): number {
  const leftTime = getSortableReleaseTime(left);
  const rightTime = getSortableReleaseTime(right);

  if (leftTime === null && rightTime === null) {
    return 0;
  }

  if (leftTime === null) {
    return 1;
  }

  if (rightTime === null) {
    return -1;
  }

  return sort === 'oldest' ? leftTime - rightTime : rightTime - leftTime;
}

function getSortableReleaseTime(release: Release): number | null {
  if (release.releaseDatePrecision !== 'day') {
    return null;
  }

  return parseDateOnly(release.releaseDate)?.getTime() ?? null;
}

function comparePopularity(left: number | null, right: number | null, sort: ReleaseSort): number {
  if (left === null && right === null) {
    return 0;
  }

  if (left === null) {
    return 1;
  }

  if (right === null) {
    return -1;
  }

  return sort === 'less-popular' ? left - right : right - left;
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function normalizeTextFilter(value?: string): string {
  return value?.trim().toLowerCase() ?? '';
}

function toGenreArray(genre?: string): string[] {
  return genre ? [genre] : [];
}

function toCountryArray(country?: string): string[] {
  return country ? [country] : [];
}

function normalizeTextFilters(values?: string[]): string[] {
  return Array.from(new Set((values ?? []).map(normalizeTextFilter).filter(Boolean)));
}

function normalizeGenreFilters(genres?: string[]): string[] {
  return Array.from(new Set((genres ?? []).map(normalizeGenreText).filter(Boolean)));
}
