import { Pool } from 'pg';

export type SyncRunStatus = 'running' | 'success' | 'failed';

export type SyncRun = {
  id: string;
  startedAt: Date;
  finishedAt: Date | null;
  status: SyncRunStatus;
  source: string;
  itemsFound: number;
  itemsSaved: number;
  errorMessage: string | null;
};

export type StartSyncRunInput = {
  source: string;
  startedAt?: Date;
};

export type FinishSyncRunInput = {
  id: string;
  status: Exclude<SyncRunStatus, 'running'>;
  itemsFound: number;
  itemsSaved: number;
  errorMessage?: string | null;
  finishedAt?: Date;
};

export type SyncRunRepository = {
  startSyncRun(input: StartSyncRunInput): Promise<SyncRun>;
  finishSyncRun(input: FinishSyncRunInput): Promise<SyncRun>;
  getLatestSyncRun(): Promise<SyncRun | null>;
};

type PostgresSyncRunRepositoryOptions = {
  pool: Pool;
};

type SyncRunRow = {
  id: string;
  started_at: Date;
  finished_at: Date | null;
  status: SyncRunStatus;
  source: string;
  items_found: number;
  items_saved: number;
  error_message: string | null;
};

export class PostgresSyncRunRepository implements SyncRunRepository {
  private readonly pool: Pool;

  constructor(options: PostgresSyncRunRepositoryOptions) {
    this.pool = options.pool;
  }

  async startSyncRun(input: StartSyncRunInput): Promise<SyncRun> {
    const result = await this.pool.query<SyncRunRow>(
      `
        insert into sync_runs (started_at, status, source)
        values ($1, 'running', $2)
        returning id, started_at, finished_at, status, source, items_found, items_saved, error_message
      `,
      [input.startedAt ?? new Date(), input.source],
    );

    return mapSyncRunRow(result.rows[0]);
  }

  async finishSyncRun(input: FinishSyncRunInput): Promise<SyncRun> {
    const errorMessage = input.status === 'success' ? null : input.errorMessage ?? 'Sync failed.';
    const result = await this.pool.query<SyncRunRow>(
      `
        update sync_runs
        set
          finished_at = $2,
          status = $3,
          items_found = $4,
          items_saved = $5,
          error_message = $6
        where id = $1
        returning id, started_at, finished_at, status, source, items_found, items_saved, error_message
      `,
      [input.id, input.finishedAt ?? new Date(), input.status, input.itemsFound, input.itemsSaved, errorMessage],
    );

    return mapSyncRunRow(result.rows[0]);
  }

  async getLatestSyncRun(): Promise<SyncRun | null> {
    const result = await this.pool.query<SyncRunRow>(
      `
        select id, started_at, finished_at, status, source, items_found, items_saved, error_message
        from sync_runs
        order by started_at desc, id desc
        limit 1
      `,
    );

    return result.rows[0] ? mapSyncRunRow(result.rows[0]) : null;
  }
}

function mapSyncRunRow(row: SyncRunRow | undefined): SyncRun {
  if (!row) {
    throw new Error('Sync run was not found.');
  }

  return {
    id: row.id,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    status: row.status,
    source: row.source,
    itemsFound: row.items_found,
    itemsSaved: row.items_saved,
    errorMessage: row.error_message,
  };
}
