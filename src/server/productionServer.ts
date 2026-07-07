import { readFile, stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { URL } from 'node:url';
import { Pool, type PoolConfig } from 'pg';
import { PostgresReleaseRepository } from '../data/postgresReleaseRepository';
import type { ReleaseRepository } from '../data/releaseRepository';
import { PostgresSyncRunRepository, type SyncRunRepository } from '../data/syncRunRepository';
import { createInternalErrorResponse, writeJsonResponse } from '../api/httpResponse';
import { handleGetInsightsRoute } from '../api/insightsRoute';
import { handleGetReleasesRoute } from '../api/releasesRoute';
import type { ReleasesApiHandlerOptions } from '../api/releasesApi';
import { getLatestSyncRunApiResponse } from '../api/syncRunsApi';

type ProductionRequestHandlerOptions = {
  repository: ReleaseRepository;
  syncRunRepository?: Pick<SyncRunRepository, 'getLatestSyncRun'>;
  publicDir?: string;
  handlerOptions?: ReleasesApiHandlerOptions;
};

type ProductionServerOptions = {
  port?: number;
  host?: string;
  publicDir?: string;
  pool?: Pool;
  repository?: ReleaseRepository;
  syncRunRepository?: Pick<SyncRunRepository, 'getLatestSyncRun'>;
  handlerOptions?: ReleasesApiHandlerOptions;
};

const DEFAULT_PORT = 4173;
const DEFAULT_HOST = '0.0.0.0';

export function createProductionRequestHandler(options: ProductionRequestHandlerOptions) {
  const publicDir = resolve(options.publicDir ?? getDefaultPublicDir());

  return (request: IncomingMessage, response: ServerResponse): void => {
    void handleProductionRequest(request, response, {
      repository: options.repository,
      syncRunRepository: options.syncRunRepository,
      publicDir,
      handlerOptions: options.handlerOptions,
    });
  };
}

export function createProductionServer(options: ProductionServerOptions = {}): Server {
  const pool = options.pool ?? (options.repository && options.syncRunRepository ? undefined : new Pool(getProductionDatabasePoolConfig()));
  const repository = options.repository ?? new PostgresReleaseRepository({ pool: pool as Pool });
  const syncRunRepository = options.syncRunRepository ?? new PostgresSyncRunRepository({ pool: pool as Pool });
  const server = createServer(
    createProductionRequestHandler({
      repository,
      syncRunRepository,
      publicDir: options.publicDir,
      handlerOptions: options.handlerOptions,
    }),
  );

  if (pool && !options.pool) {
    server.once('close', () => {
      void pool.end();
    });
  }

  return server;
}

export function getProductionDatabasePoolConfig(): PoolConfig | undefined {
  return process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : undefined;
}

async function handleProductionRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: Required<Pick<ProductionRequestHandlerOptions, 'repository'>> & {
    syncRunRepository?: Pick<SyncRunRepository, 'getLatestSyncRun'>;
    publicDir: string;
    handlerOptions?: ReleasesApiHandlerOptions;
  },
): Promise<void> {
  const requestUrl = new URL(request.url ?? '/', 'http://fresh-drop.local');

  if (request.method === 'GET' && requestUrl.pathname === '/api/releases') {
    try {
      const result = await handleGetReleasesRoute(options.repository, request.url ?? '/api/releases', options.handlerOptions);
      writeJsonResponse(response, result);
    } catch {
      writeJsonResponse(response, createInternalErrorResponse(), 500);
    }
    return;
  }

  if (request.method === 'GET' && requestUrl.pathname === '/api/insights') {
    if (!options.repository.listInsightsReleases) {
      writeJsonResponse(response, createInternalErrorResponse(), 500);
      return;
    }

    try {
      const result = await handleGetInsightsRoute(
        { listInsightsReleases: options.repository.listInsightsReleases.bind(options.repository) },
        request.url ?? '/api/insights',
        options.handlerOptions,
      );
      writeJsonResponse(response, result);
    } catch {
      writeJsonResponse(response, createInternalErrorResponse(), 500);
    }
    return;
  }

  if (request.method === 'GET' && requestUrl.pathname === '/api/sync-runs/latest') {
    const result = options.syncRunRepository
      ? await getLatestSyncRunApiResponse(options.syncRunRepository)
      : createInternalErrorResponse();
    writeJsonResponse(response, result, options.syncRunRepository ? undefined : 500);
    return;
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.statusCode = 405;
    response.setHeader('Allow', 'GET, HEAD');
    response.end('Method not allowed');
    return;
  }

  await serveStaticBuild(request, response, options.publicDir, requestUrl.pathname);
}

async function serveStaticBuild(
  request: IncomingMessage,
  response: ServerResponse,
  publicDir: string,
  pathname: string,
): Promise<void> {
  const filePath = getStaticFilePath(publicDir, pathname);
  const fallbackPath = join(publicDir, 'index.html');
  const resolvedPath = (await getReadableFilePath(filePath)) ?? (await getReadableFilePath(fallbackPath));

  if (!resolvedPath) {
    response.statusCode = 404;
    response.end('Not found');
    return;
  }

  response.statusCode = 200;
  response.setHeader('Content-Type', getContentType(resolvedPath));

  if (request.method === 'HEAD') {
    response.end();
    return;
  }

  try {
    response.end(await readFile(resolvedPath));
  } catch {
    if (!response.headersSent) {
      response.statusCode = 500;
    }
    response.end('Internal server error');
  }
}

function getStaticFilePath(publicDir: string, pathname: string): string {
  const relativePath = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const resolvedPath = resolve(publicDir, relativePath);

  if (resolvedPath !== publicDir && !resolvedPath.startsWith(`${publicDir}${sep}`)) {
    return join(publicDir, 'index.html');
  }

  return resolvedPath;
}

async function getReadableFilePath(pathname: string): Promise<string | undefined> {
  try {
    const stats = await stat(pathname);

    return stats.isFile() ? pathname : undefined;
  } catch {
    return undefined;
  }
}

function getContentType(pathname: string): string {
  switch (extname(pathname)) {
    case '.css':
      return 'text/css; charset=utf-8';
    case '.html':
      return 'text/html; charset=utf-8';
    case '.js':
      return 'text/javascript; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    case '.webp':
      return 'image/webp';
    default:
      return 'application/octet-stream';
  }
}

function getDefaultPublicDir(): string {
  return resolve(process.cwd(), 'dist');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT ?? DEFAULT_PORT);
  const host = process.env.HOST ?? DEFAULT_HOST;

  createProductionServer().listen(port, host, () => {
    console.log(`Fresh Drop server listening on http://${host}:${port}`);
  });
}
