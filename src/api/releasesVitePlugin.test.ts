import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import type { ReleasePage, ReleaseRepository } from '../data/releaseRepository';
import { createReleasesApiMiddleware } from './releasesVitePlugin';

describe('createReleasesApiMiddleware', () => {
  it('handles GET /api/releases through the repository and writes JSON', async () => {
    const repository = makeRepository();
    const currentDate = new Date('2026-07-01T12:00:00.000Z');
    const response = makeResponse();
    const middleware = createReleasesApiMiddleware(repository, { currentDate });

    middleware(
      makeRequest('/api/releases?period=14d&page=2&limit=10'),
      response.nodeResponse,
      vi.fn(),
    );
    await response.finished;

    expect(repository.findReleases).toHaveBeenCalledWith({
      period: '14d',
      genre: undefined,
      genres: undefined,
      excludedGenres: undefined,
      country: undefined,
      countries: undefined,
      popularityMin: undefined,
      popularityMax: undefined,
      type: 'all',
      sort: 'newest',
      page: 2,
      limit: 10,
      currentDate,
      randomStartSeed: undefined,
    });
    expect(response.nodeResponse.statusCode).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/json; charset=utf-8');
    expect(JSON.parse(response.body)).toEqual({
      items: [],
      genres: [],
      countries: [],
      pagination: {
        page: 1,
        limit: 20,
        total: 0,
        hasNextPage: false,
      },
      error: null,
    });
  });

  it('returns 400 for invalid release query parameters', async () => {
    const response = makeResponse();
    const middleware = createReleasesApiMiddleware(makeRepository());

    middleware(makeRequest('/api/releases?period=30d'), response.nodeResponse, vi.fn());
    await response.finished;

    expect(response.nodeResponse.statusCode).toBe(400);
    expect(JSON.parse(response.body).error).toEqual({
      code: 'invalid_query',
      message: 'Invalid period query parameter.',
    });
  });

  it('handles GET /api/sync-runs/latest through the sync run repository', async () => {
    const response = makeResponse();
    const syncRunRepository = {
      getLatestSyncRun: vi.fn().mockResolvedValue({
        id: 'sync-run-1',
        startedAt: new Date('2026-07-01T12:00:00.000Z'),
        finishedAt: new Date('2026-07-01T12:01:00.000Z'),
        status: 'success',
        source: 'spotify',
        itemsFound: 50,
        itemsSaved: 48,
        errorMessage: null,
      }),
    };
    const middleware = createReleasesApiMiddleware(makeRepository(), {}, syncRunRepository);

    middleware(makeRequest('/api/sync-runs/latest'), response.nodeResponse, vi.fn());
    await response.finished;

    expect(response.nodeResponse.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      item: {
        id: 'sync-run-1',
        startedAt: '2026-07-01T12:00:00.000Z',
        finishedAt: '2026-07-01T12:01:00.000Z',
        status: 'success',
        source: 'spotify',
        itemsFound: 50,
        itemsSaved: 48,
        errorMessage: null,
      },
      error: null,
    });
  });

  it('passes non-release requests to the next middleware', () => {
    const next = vi.fn();
    const response = makeResponse();
    const middleware = createReleasesApiMiddleware(makeRepository());

    middleware(makeRequest('/assets/app.js'), response.nodeResponse, next);

    expect(next).toHaveBeenCalledOnce();
    expect(response.end).not.toHaveBeenCalled();
  });
});

function makeRepository(
  findResult: ReleasePage = { items: [], pagination: { page: 1, limit: 20, total: 0, hasNextPage: false } },
): ReleaseRepository {
  return {
    saveReleases: vi.fn(),
    findExistingReleaseIds: vi.fn().mockResolvedValue(new Set()),
    findCachedArtists: vi.fn().mockResolvedValue(new Map()),
    saveReleaseMarkets: vi.fn(),
    cleanupOldReleases: vi.fn(),
    listActiveGenres: vi.fn().mockResolvedValue([]),
    listActiveCountries: vi.fn().mockResolvedValue([]),
    findReleases: vi.fn().mockResolvedValue(findResult),
  };
}

function makeRequest(url: string): IncomingMessage {
  return {
    method: 'GET',
    url,
  } as IncomingMessage;
}

function makeResponse(): {
  nodeResponse: ServerResponse;
  headers: Map<string, string>;
  body: string;
  end: ReturnType<typeof vi.fn>;
  finished: Promise<void>;
} {
  const headers = new Map<string, string>();
  let body = '';
  let finish: () => void = () => undefined;
  const finished = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const response = {
    statusCode: 0,
    setHeader: vi.fn((name: string, value: string) => {
      headers.set(name, value);
      return response;
    }),
    end: vi.fn((chunk: string) => {
      body = chunk;
      finish();
      return response;
    }),
  } as unknown as ServerResponse;

  return {
    nodeResponse: response,
    headers,
    get body() {
      return body;
    },
    end: response.end as ReturnType<typeof vi.fn>,
    finished,
  };
}
