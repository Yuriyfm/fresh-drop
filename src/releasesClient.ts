import type { PopularityFilter, ReleasePeriod, ReleaseTypeFilter } from './domain/release';
import type { ReleasesApiResponse, ReleasesApiResult } from './api/releasesApi';

export type FetchReleasesQuery = {
  period: ReleasePeriod;
  genre?: string;
  country?: string;
  type: ReleaseTypeFilter;
  popularity: PopularityFilter;
  page: number;
  limit: number;
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
    popularity: query.popularity,
    page: String(query.page),
    limit: String(query.limit),
  });

  appendOptionalParam(params, 'genre', query.genre);
  appendOptionalParam(params, 'country', query.country);

  return params;
}

function appendOptionalParam(params: URLSearchParams, name: string, value?: string): void {
  const normalized = value?.trim();

  if (normalized) {
    params.set(name, normalized);
  }
}
