import type { IncomingMessage, ServerResponse } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import type { ReleasePage, ReleaseRepository } from '../data/releaseRepository';
import { createProductionRequestHandler, getProductionDatabasePoolConfig } from './productionServer';

describe('createProductionRequestHandler', () => {
  it('serves GET /api/releases through the shared releases route', async () => {
    const repository = makeRepository();
    const currentDate = new Date('2026-07-01T12:00:00.000Z');
    const response = makeResponse();
    const handler = createProductionRequestHandler({
      repository,
      handlerOptions: { currentDate },
    });

    handler(makeRequest('/api/releases?period=14d&page=2&limit=10'), response.nodeResponse);
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

  it('serves built frontend files from the configured public directory', async () => {
    const publicDir = join(tmpdir(), `fresh-drop-${Date.now()}`);
    await mkdir(publicDir, { recursive: true });
    await writeFile(join(publicDir, 'index.html'), '<div id="root"></div>', 'utf8');
    const response = makeResponse();
    const handler = createProductionRequestHandler({
      repository: makeRepository(),
      publicDir,
    });

    handler(makeRequest('/'), response.nodeResponse);
    await response.finished;

    expect(response.nodeResponse.statusCode).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
    expect(response.body).toBe('<div id="root"></div>');
  });

  it('serves GET /api/sync-runs/latest through the sync run repository', async () => {
    const response = makeResponse();
    const handler = createProductionRequestHandler({
      repository: makeRepository(),
      syncRunRepository: {
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
      },
    });

    handler(makeRequest('/api/sync-runs/latest'), response.nodeResponse);
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

  it('uses DATABASE_URL for the production PostgreSQL pool config', () => {
    const previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = 'postgres://fresh_drop:fresh_drop@127.0.0.1:5432/fresh_drop';

    try {
      expect(getProductionDatabasePoolConfig()).toEqual({
        connectionString: 'postgres://fresh_drop:fresh_drop@127.0.0.1:5432/fresh_drop',
      });
    } finally {
      if (previousDatabaseUrl === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = previousDatabaseUrl;
      }
    }
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

function makeRequest(url: string, method = 'GET'): IncomingMessage {
  return {
    method,
    url,
  } as IncomingMessage;
}

function makeResponse(): {
  nodeResponse: ServerResponse;
  headers: Map<string, string>;
  body: string;
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
    headersSent: false,
    setHeader: vi.fn((name: string, value: string) => {
      headers.set(name, value);
      return response;
    }),
    end: vi.fn((chunk = '') => {
      body += chunk;
      finish();
      return response;
    }),
    write: vi.fn((chunk: string | Buffer) => {
      body += chunk.toString();
      return true;
    }),
    once: vi.fn(),
    emit: vi.fn(),
  } as unknown as ServerResponse;

  return {
    nodeResponse: response,
    headers,
    get body() {
      return body;
    },
    finished,
  };
}
