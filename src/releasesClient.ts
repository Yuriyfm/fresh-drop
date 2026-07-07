import type { ReleasePeriod, ReleaseSort, ReleaseTypeFilter } from './domain/release';
import type { ReleasesApiResponse, ReleasesApiResult } from './api/releasesApi';

export type FetchReleasesQuery = {
  period: ReleasePeriod;
  genre?: string;
  genres?: string[];
  country?: string;
  countries?: string[];
  popularityMin?: number;
  popularityMax?: number;
  type: ReleaseTypeFilter;
  sort: ReleaseSort;
  page: number;
  limit: number;
  randomStartSeed?: string;
};

export type FetchReleasesOptions = {
  signal?: AbortSignal;
  fetchFn?: typeof fetch;
};

export class ReleasesClientError extends Error {
  readonly code: string;

  constructor(message: string, code = 'request_failed') {
    super(message);
    this.name = 'ReleasesClientError';
    this.code = code;
  }
}

export async function fetchReleases(
  query: FetchReleasesQuery,
  options: FetchReleasesOptions = {},
): Promise<ReleasesApiResponse> {
  const fetchFn = options.fetchFn ?? fetch;
  const response = await fetchFn(`/api/releases?${toSearchParams(query)}`, {
    headers: {
      Accept: 'application/json',
    },
    signal: options.signal,
  });
  const payload = (await response.json()) as ReleasesApiResult;

  if (payload.error) {
    throw new ReleasesClientError(payload.error.message, payload.error.code);
  }

  if (!response.ok) {
    throw new ReleasesClientError('Unable to load releases.');
  }

  return payload;
}

function toSearchParams(query: FetchReleasesQuery): URLSearchParams {
  const params = new URLSearchParams({
    period: query.period,
    type: query.type,
    sort: query.sort,
    page: String(query.page),
    limit: String(query.limit),
  });

  appendOptionalParams(params, 'genre', query.genres ?? (query.genre ? [query.genre] : []));
  appendOptionalParams(params, 'country', query.countries ?? (query.country ? [query.country] : []));
  appendOptionalNumberParam(params, 'popularityMin', query.popularityMin);
  appendOptionalNumberParam(params, 'popularityMax', query.popularityMax);
  appendOptionalParam(params, 'randomStartSeed', query.randomStartSeed);

  return params;
}

function appendOptionalParams(params: URLSearchParams, name: string, values: string[]): void {
  for (const value of values) {
    const normalized = value.trim();

    if (normalized) {
      params.append(name, normalized);
    }
  }
}

function appendOptionalParam(params: URLSearchParams, name: string, value?: string): void {
  const normalized = value?.trim();

  if (normalized) {
    params.set(name, normalized);
  }
}

function appendOptionalNumberParam(params: URLSearchParams, name: string, value?: number): void {
  if (value !== undefined && Number.isFinite(value)) {
    params.set(name, String(value));
  }
}
