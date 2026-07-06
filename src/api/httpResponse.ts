import type { ServerResponse } from 'node:http';
import type { ReleasesApiErrorResponse, ReleasesApiResult } from './releasesApi';

export function writeJsonResponse(
  response: ServerResponse,
  result: unknown,
  statusCode = getStatusCode(result),
): void {
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(result));
}

export function getStatusCode(result: unknown): number {
  const error = getResponseError(result);

  if (!error) {
    return 200;
  }

  return error.code === 'invalid_query' ? 400 : 500;
}

export function createInternalErrorResponse(): ReleasesApiErrorResponse {
  return {
    items: [],
    genres: [],
    countries: [],
    pagination: {
      page: 1,
      limit: 20,
      total: 0,
      hasNextPage: false,
    },
    error: {
      code: 'internal_error',
      message: 'Internal server error.',
    },
  };
}

function getResponseError(result: unknown): { code?: string } | null {
  if (!result || typeof result !== 'object' || !('error' in result)) {
    return null;
  }

  const error = result.error;

  return error && typeof error === 'object' ? error : null;
}
