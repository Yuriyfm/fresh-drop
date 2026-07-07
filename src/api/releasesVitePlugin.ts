import { Pool } from 'pg';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { PostgresReleaseRepository } from '../data/postgresReleaseRepository';
import type { ReleaseRepository } from '../data/releaseRepository';
import { PostgresSyncRunRepository, type SyncRunRepository } from '../data/syncRunRepository';
import { createInternalErrorResponse, writeJsonResponse } from './httpResponse';
import { handleGetInsightsRoute } from './insightsRoute';
import { handleGetReleasesRoute } from './releasesRoute';
import type { ReleasesApiHandlerOptions } from './releasesApi';
import { getLatestSyncRunApiResponse } from './syncRunsApi';

export type ReleasesApiPluginOptions = {
  pool?: Pool;
  repository?: ReleaseRepository;
  syncRunRepository?: Pick<SyncRunRepository, 'getLatestSyncRun'>;
  handlerOptions?: ReleasesApiHandlerOptions;
};

type MiddlewareNext = () => void;

export function createReleasesApiPlugin(options: ReleasesApiPluginOptions = {}): Plugin {
  return {
    name: 'fresh-drop-releases-api',
    configureServer(server) {
      let poolToClose: Pool | undefined;
      let repository = options.repository;
      let syncRunRepository = options.syncRunRepository;

      if (!repository || !syncRunRepository) {
        const pool = options.pool ?? new Pool();
        repository = repository ?? new PostgresReleaseRepository({ pool });
        syncRunRepository = syncRunRepository ?? new PostgresSyncRunRepository({ pool });
        poolToClose = options.pool ? undefined : pool;
      }

      server.middlewares.use(createReleasesApiMiddleware(repository, options.handlerOptions, syncRunRepository));

      if (poolToClose) {
        server.httpServer?.once('close', () => {
          void poolToClose.end();
        });
      }
    },
  };
}

export function createReleasesApiMiddleware(
  repository: ReleaseRepository,
  handlerOptions: ReleasesApiHandlerOptions = {},
  syncRunRepository?: Pick<SyncRunRepository, 'getLatestSyncRun'>,
) {
  return (request: IncomingMessage, response: ServerResponse, next: MiddlewareNext): void => {
    const pathname = getRequestPathname(request.url);

    if (request.method === 'GET' && pathname === '/api/releases') {
      void handleGetReleasesRoute(repository, request.url ?? '/api/releases', handlerOptions)
        .then((result) => writeJsonResponse(response, result))
        .catch(() => writeJsonResponse(response, createInternalErrorResponse(), 500));
      return;
    }

    if (request.method === 'GET' && pathname === '/api/insights') {
      if (!repository.listInsightsReleases) {
        writeJsonResponse(response, createInternalErrorResponse(), 500);
        return;
      }

      void handleGetInsightsRoute(
        { listInsightsReleases: repository.listInsightsReleases.bind(repository) },
        request.url ?? '/api/insights',
        handlerOptions,
      )
        .then((result) => writeJsonResponse(response, result))
        .catch(() => writeJsonResponse(response, createInternalErrorResponse(), 500));
      return;
    }

    if (request.method === 'GET' && pathname === '/api/sync-runs/latest' && syncRunRepository) {
      void getLatestSyncRunApiResponse(syncRunRepository).then((result) => writeJsonResponse(response, result));
      return;
    }

    if (request.method === 'GET' && pathname === '/api/sync-runs/latest') {
      writeJsonResponse(response, createInternalErrorResponse(), 500);
      return;
    }

    next();
  };
}

function getRequestPathname(url?: string): string {
  return new URL(url ?? '/', 'http://fresh-drop.local').pathname;
}
