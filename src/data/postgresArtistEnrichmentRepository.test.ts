import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { PostgresArtistEnrichmentRepository } from './postgresArtistEnrichmentRepository';

describe('PostgresArtistEnrichmentRepository', () => {
  it('orders pending and retryable records by the time they became eligible', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const repository = new PostgresArtistEnrichmentRepository({
      pool: { query } as unknown as Pool,
    });
    const now = new Date('2026-07-30T12:00:00.000Z');

    await repository.findArtistsForProcessing({ limit: 100, now });

    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("ae.match_status in ('failed', 'not_found', 'ambiguous', 'matched')");
    expect(sql).toContain("ae.match_status = 'failed' and ae.next_retry_at is null");
    expect(sql).toContain("when ae.match_status = 'pending' then ae.created_at");
    expect(sql).not.toContain("when 'pending' then 0");
    expect(params).toEqual([now, 100]);
  });
});
