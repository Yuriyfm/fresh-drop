import type { ReleaseRepository } from '../data/releaseRepository';
import { getReleasesApiResponse, type ReleasesApiHandlerOptions, type ReleasesApiQuery, type ReleasesApiResult } from './releasesApi';

export type ReleasesRouteInput = string | URL | URLSearchParams | ReleasesApiQuery;

export async function handleGetReleasesRoute(
  repository: ReleaseRepository,
  input: ReleasesRouteInput = {},
  options: ReleasesApiHandlerOptions = {},
): Promise<ReleasesApiResult> {
  return getReleasesApiResponse(repository, toReleasesApiQuery(input), options);
}

function toReleasesApiQuery(input: ReleasesRouteInput): ReleasesApiQuery {
  if (input instanceof URL) {
    return queryFromSearchParams(input.searchParams);
  }

  if (input instanceof URLSearchParams) {
    return queryFromSearchParams(input);
  }

  if (typeof input === 'string') {
    return queryFromString(input);
  }

  return input;
}

function queryFromString(input: string): ReleasesApiQuery {
  const trimmed = input.trim();

  if (trimmed === '') {
    return {};
  }

  if (trimmed.startsWith('?')) {
    return queryFromSearchParams(new URLSearchParams(trimmed));
  }

  try {
    return queryFromSearchParams(new URL(trimmed, 'http://fresh-drop.local').searchParams);
  } catch {
    return queryFromSearchParams(new URLSearchParams(trimmed));
  }
}

function queryFromSearchParams(searchParams: URLSearchParams): ReleasesApiQuery {
  const query: ReleasesApiQuery = {};

  searchParams.forEach((_value, key) => {
    const values = searchParams.getAll(key);

    query[key] = values.length > 1 ? values : values[0];
  });

  return query;
}
