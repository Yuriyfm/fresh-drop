import {
  getInsightsApiResponse,
  type InsightsApiHandlerOptions,
  type InsightsApiQuery,
  type InsightsApiResult,
  type InsightsReleaseRepository,
} from './insightsApi';

export type InsightsRouteInput = string | URL | URLSearchParams | InsightsApiQuery;

export async function handleGetInsightsRoute(
  repository: InsightsReleaseRepository,
  input: InsightsRouteInput = {},
  options: InsightsApiHandlerOptions = {},
): Promise<InsightsApiResult> {
  return getInsightsApiResponse(repository, toInsightsApiQuery(input), options);
}

function toInsightsApiQuery(input: InsightsRouteInput): InsightsApiQuery {
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

function queryFromString(input: string): InsightsApiQuery {
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

function queryFromSearchParams(searchParams: URLSearchParams): InsightsApiQuery {
  const query: InsightsApiQuery = {};

  searchParams.forEach((_value, key) => {
    const values = searchParams.getAll(key);

    query[key] = values.length > 1 ? values : values[0];
  });

  return query;
}
