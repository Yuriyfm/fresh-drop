import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PostgresSyncRunRepository } from './syncRunRepository';

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeWithPostgres = testDatabaseUrl ? describe : describe.skip;

describeWithPostgres('PostgresSyncRunRepository', () => {
  const schemaName = `fresh_drop_test_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  let pool: Pool;
  let repository: PostgresSyncRunRepository;

  beforeAll(async () => {
    pool = new Pool({
      connectionString: testDatabaseUrl,
      max: 1,
      options: `-c search_path=${schemaName}`,
    });
    repository = new PostgresSyncRunRepository({ pool });

    await pool.query(`create schema ${quoteIdentifier(schemaName)}`);
    await pool.query(readFileSync(resolve(process.cwd(), 'db/schema.sql'), 'utf8'));
  });

  beforeEach(async () => {
    await pool.query('truncate sync_runs restart identity cascade');
  });

  afterAll(async () => {
    if (!pool) {
      return;
    }

    await pool.query(`drop schema if exists ${quoteIdentifier(schemaName)} cascade`);
    await pool.end();
  });

  it('starts and finishes a successful sync run', async () => {
    const started = await repository.startSyncRun({
      source: 'spotify',
      startedAt: new Date('2026-07-01T12:00:00.000Z'),
    });

    const finished = await repository.finishSyncRun({
      id: started.id,
      status: 'success',
      itemsFound: 3,
      itemsSaved: 2,
      finishedAt: new Date('2026-07-01T12:01:00.000Z'),
    });

    expect(finished).toMatchObject({
      id: started.id,
      status: 'success',
      source: 'spotify',
      itemsFound: 3,
      itemsSaved: 2,
      errorMessage: null,
    });
    expect(finished.finishedAt).toBeInstanceOf(Date);
  });

  it('stores a failed sync run error message', async () => {
    const started = await repository.startSyncRun({ source: 'spotify' });

    const finished = await repository.finishSyncRun({
      id: started.id,
      status: 'failed',
      itemsFound: 0,
      itemsSaved: 0,
      errorMessage: 'Rate limited. Retry after 10 seconds.',
    });

    expect(finished).toMatchObject({
      status: 'failed',
      itemsFound: 0,
      itemsSaved: 0,
      errorMessage: 'Rate limited. Retry after 10 seconds.',
    });
  });

  it('returns the latest sync run by start time', async () => {
    await repository.startSyncRun({
      source: 'spotify',
      startedAt: new Date('2026-07-01T12:00:00.000Z'),
    });
    const latestStarted = await repository.startSyncRun({
      source: 'spotify',
      startedAt: new Date('2026-07-01T13:00:00.000Z'),
    });

    const latest = await repository.finishSyncRun({
      id: latestStarted.id,
      status: 'success',
      itemsFound: 10,
      itemsSaved: 9,
      finishedAt: new Date('2026-07-01T13:01:00.000Z'),
    });

    await expect(repository.getLatestSyncRun()).resolves.toMatchObject({
      id: latest.id,
      status: 'success',
      itemsFound: 10,
      itemsSaved: 9,
    });
  });

  it('returns null when sync runs are empty', async () => {
    await expect(repository.getLatestSyncRun()).resolves.toBeNull();
  });
});

function quoteIdentifier(value: string): string {
  return `"${value.split('"').join('""')}"`;
}
