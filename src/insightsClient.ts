import type { InsightsApiResult, InsightsApiResponse } from './api/insightsApi';
import type { InsightsPeriod, InsightsType } from './domain/insights';

export type FetchInsightsQuery = {
  period: InsightsPeriod;
  type: InsightsType;
};

export type FetchInsightsOptions = {
  signal?: AbortSignal;
  fetchFn?: typeof fetch;
};

export class InsightsClientError extends Error {
  readonly code: string;

  constructor(message: string, code = 'request_failed') {
    super(message);
    this.name = 'InsightsClientError';
    this.code = code;
  }
}

export async function fetchInsights(
  query: FetchInsightsQuery,
  options: FetchInsightsOptions = {},
): Promise<InsightsApiResponse> {
  const fetchFn = options.fetchFn ?? fetch;
  const response = await fetchFn(`/api/insights?${toSearchParams(query)}`, {
    headers: {
      Accept: 'application/json',
    },
    signal: options.signal,
  });
  const payload = (await response.json()) as InsightsApiResult;

  if (payload.error) {
    throw new InsightsClientError(payload.error.message, payload.error.code);
  }

  if (!response.ok) {
    throw new InsightsClientError('Unable to load insights.');
  }

  return payload;
}

function toSearchParams(query: FetchInsightsQuery): URLSearchParams {
  return new URLSearchParams({
    period: String(query.period),
    type: query.type,
  });
}
