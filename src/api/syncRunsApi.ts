import type { SyncRun, SyncRunRepository } from '../data/syncRunRepository';

export type LatestSyncRunApiResponse = {
  item: SerializedSyncRun | null;
  error: null;
};

export type LatestSyncRunApiErrorResponse = {
  item: null;
  error: {
    code: 'internal_error';
    message: string;
  };
};

export type LatestSyncRunApiResult = LatestSyncRunApiResponse | LatestSyncRunApiErrorResponse;

export type SerializedSyncRun = {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  status: SyncRun['status'];
  source: string;
  itemsFound: number;
  itemsSaved: number;
  errorMessage: string | null;
};

export async function getLatestSyncRunApiResponse(
  repository: Pick<SyncRunRepository, 'getLatestSyncRun'>,
): Promise<LatestSyncRunApiResult> {
  try {
    const syncRun = await repository.getLatestSyncRun();

    return {
      item: syncRun ? serializeSyncRun(syncRun) : null,
      error: null,
    };
  } catch {
    return createLatestSyncRunErrorResponse();
  }
}

export function createLatestSyncRunErrorResponse(): LatestSyncRunApiErrorResponse {
  return {
    item: null,
    error: {
      code: 'internal_error',
      message: 'Internal server error.',
    },
  };
}

function serializeSyncRun(syncRun: SyncRun): SerializedSyncRun {
  return {
    id: syncRun.id,
    startedAt: syncRun.startedAt.toISOString(),
    finishedAt: syncRun.finishedAt ? syncRun.finishedAt.toISOString() : null,
    status: syncRun.status,
    source: syncRun.source,
    itemsFound: syncRun.itemsFound,
    itemsSaved: syncRun.itemsSaved,
    errorMessage: syncRun.errorMessage,
  };
}
