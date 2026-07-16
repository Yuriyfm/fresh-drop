import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('production scheduler cron safety', () => {
  it('wraps cron commands with process-level locks before starting yarn', () => {
    const entrypoint = readFileSync('docker/scheduler-entrypoint.sh', 'utf8');

    expect(entrypoint).toContain('/bin/sh /app/docker/run-cron-command.sh crawler yarn crawl:scheduled');
    expect(entrypoint).toContain('/bin/sh /app/docker/run-cron-command.sh cleanup yarn cleanup:releases');
    expect(entrypoint).toContain('/bin/sh /app/docker/run-cron-command.sh musicbrainz-enrichment yarn enrich:musicbrainz:artists');
    expect(entrypoint).not.toContain('TMPDIR=/tmp yarn crawl:scheduled');
    expect(entrypoint).not.toContain('TMPDIR=/tmp yarn enrich:musicbrainz:artists');
  });

  it('keeps tracked production MusicBrainz enrichment defaults conservative', () => {
    const productionEnvExample = readFileSync('.env.production.example', 'utf8');
    const compose = readFileSync('docker-compose.prod.yml', 'utf8');

    expect(productionEnvExample).toContain('ENRICH_MUSICBRAINZ_CRON_SCHEDULE=*/5 * * * *');
    expect(productionEnvExample).toContain('ENRICH_MUSICBRAINZ_LIMIT=20');
    expect(productionEnvExample).not.toContain('ENRICH_MUSICBRAINZ_CRON_SCHEDULE=* * * * *');
    expect(productionEnvExample).not.toContain('ENRICH_MUSICBRAINZ_LIMIT=300');
    expect(compose).toContain('ENRICH_MUSICBRAINZ_CRON_SCHEDULE: ${ENRICH_MUSICBRAINZ_CRON_SCHEDULE:-*/5 * * * *}');
    expect(compose).toContain('ENRICH_MUSICBRAINZ_LIMIT: ${ENRICH_MUSICBRAINZ_LIMIT:-20}');
  });
});
