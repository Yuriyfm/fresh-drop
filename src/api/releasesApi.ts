import type { Release, ReleasePeriod, ReleaseSort, ReleaseTypeFilter } from '../domain/release';
import type { ReleaseQuery, ReleaseRepository } from '../data/releaseRepository';

export type GenreOption = {
  name: string;
  releaseCount: number;
  kind: 'general' | 'exact' | 'missing';
};

export type CountryOption = {
  name: string;
  releaseCount: number;
};

export type ReleasesApiQuery = Record<string, string | string[] | number | undefined>;

export type ReleasesApiResponse = {
  items: Release[];
  genres: GenreOption[];
  countries: CountryOption[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    hasNextPage: boolean;
  };
  error: null;
};

export type ReleasesApiErrorResponse = {
  items: [];
  genres: [];
  countries: [];
  pagination: {
    page: number;
    limit: number;
    total: 0;
    hasNextPage: false;
  };
  error: {
    code: 'invalid_query' | 'internal_error';
    message: string;
  };
};

export type ReleasesApiResult = ReleasesApiResponse | ReleasesApiErrorResponse;

export type ReleasesApiHandlerOptions = {
  currentDate?: Date;
};

const DEFAULT_PERIOD = '7d';
const DEFAULT_TYPE = 'all';
const DEFAULT_SORT = 'newest';
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

const allowedPeriods = ['7d', '14d', '1m'] as const;
const allowedTypes = ['all', 'single', 'album', 'compilation'] as const;
const allowedSorts = ['newest', 'oldest', 'popular', 'less-popular'] as const;

export async function getReleasesApiResponse(
  repository: ReleaseRepository,
  query: ReleasesApiQuery = {},
  options: ReleasesApiHandlerOptions = {},
): Promise<ReleasesApiResult> {
  const normalized = normalizeReleasesQuery(query, options.currentDate);

  if (!normalized.ok) {
    return createErrorResponse(normalized.page, normalized.limit, 'invalid_query', normalized.message);
  }

  try {
    const [result, genres, countries] = await Promise.all([
      repository.findReleases(normalized.query),
      repository.listActiveGenres(),
      repository.listActiveCountries(),
    ]);

    return {
      items: result.items,
      genres: genres.map((genre) => ({
        name: genre.genre,
        releaseCount: genre.releaseCount,
        kind: genre.kind,
      })),
      countries: countries.map((country) => ({
        name: country.country,
        releaseCount: country.releaseCount,
      })),
      pagination: result.pagination,
      error: null,
    };
  } catch {
    return createErrorResponse(
      normalized.query.page ?? DEFAULT_PAGE,
      normalized.query.limit ?? DEFAULT_LIMIT,
      'internal_error',
      'Internal server error.',
    );
  }
}

type NormalizedReleasesQueryResult =
  | {
      ok: true;
      query: ReleaseQuery;
    }
  | {
      ok: false;
      page: number;
      limit: number;
      message: string;
    };

function normalizeReleasesQuery(query: ReleasesApiQuery, currentDate?: Date): NormalizedReleasesQueryResult {
  const page = parsePositiveInteger(query.page, DEFAULT_PAGE);
  const limit = parsePositiveInteger(query.limit, DEFAULT_LIMIT);
  const period = getSingleQueryValue(query.period) ?? DEFAULT_PERIOD;
  const type = getSingleQueryValue(query.type) ?? DEFAULT_TYPE;
  const sort = getSingleQueryValue(query.sort) ?? DEFAULT_SORT;

  if (!isAllowedValue(period, allowedPeriods)) {
    return createInvalidQueryResult(page.value, limit.value, 'Invalid period query parameter.');
  }

  if (!isAllowedValue(type, allowedTypes)) {
    return createInvalidQueryResult(page.value, limit.value, 'Invalid type query parameter.');
  }

  if (!isAllowedValue(sort, allowedSorts)) {
    return createInvalidQueryResult(page.value, limit.value, 'Invalid sort query parameter.');
  }

  if (!page.ok) {
    return createInvalidQueryResult(DEFAULT_PAGE, limit.value, 'Invalid page query parameter.');
  }

  if (!limit.ok || limit.value > MAX_LIMIT) {
    return createInvalidQueryResult(page.value, DEFAULT_LIMIT, 'Invalid limit query parameter.');
  }

  return {
    ok: true,
    query: {
      period,
      genre: normalizeOptionalText(query.genre),
      genres: normalizeOptionalTextList(query.genres ?? query.genre),
      country: normalizeOptionalText(query.country),
      countries: normalizeOptionalTextList(query.countries ?? query.country),
      type,
      sort,
      page: page.value,
      limit: limit.value,
      currentDate,
      randomStartSeed: normalizeOptionalText(query.randomStartSeed),
    },
  };
}

function createInvalidQueryResult(page: number, limit: number, message: string): NormalizedReleasesQueryResult {
  return {
    ok: false,
    page,
    limit,
    message,
  };
}

function createErrorResponse(
  page: number,
  limit: number,
  code: ReleasesApiErrorResponse['error']['code'],
  message: string,
): ReleasesApiErrorResponse {
  return {
    items: [],
    genres: [],
    countries: [],
    pagination: {
      page,
      limit,
      total: 0,
      hasNextPage: false,
    },
    error: {
      code,
      message,
    },
  };
}

function parsePositiveInteger(
  value: string | string[] | number | undefined,
  defaultValue: number,
): { ok: boolean; value: number } {
  if (value === undefined) {
    return { ok: true, value: defaultValue };
  }

  if (Array.isArray(value)) {
    return { ok: false, value: defaultValue };
  }

  const normalized = typeof value === 'number' ? value : Number(value);

  if (!Number.isInteger(normalized) || normalized < 1) {
    return { ok: false, value: defaultValue };
  }

  return { ok: true, value: normalized };
}

function normalizeOptionalText(value: string | string[] | number | undefined): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim();

  return normalized === '' ? undefined : normalized;
}

function normalizeOptionalTextList(value: string | string[] | number | undefined): string[] | undefined {
  const values = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
  const normalized = Array.from(
    new Set(
      values
        .flatMap((item) => item.split(','))
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );

  return normalized.length > 0 ? normalized : undefined;
}

function isAllowedValue(value: string | number, allowed: readonly ReleasePeriod[]): value is ReleasePeriod;
function isAllowedValue(value: string | number, allowed: readonly ReleaseTypeFilter[]): value is ReleaseTypeFilter;
function isAllowedValue(value: string | number, allowed: readonly ReleaseSort[]): value is ReleaseSort;
function isAllowedValue(value: string | number, allowed: readonly string[]): boolean {
  return typeof value === 'string' && allowed.includes(value);
}

function getSingleQueryValue(value: string | string[] | number | undefined): string | number | undefined {
  return Array.isArray(value) ? value[0] : value;
}
