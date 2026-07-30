import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('production scheduler cron safety', () => {
  it('wraps prebuilt Node jobs with process-level locks', () => {
    const entrypoint = readFileSync('docker/scheduler-entrypoint.sh', 'utf8');

    expect(entrypoint).toContain('/bin/sh /app/docker/run-cron-command.sh crawler node /app/dist-scheduler/crawlReleases.js');
    expect(entrypoint).toContain('/bin/sh /app/docker/run-cron-command.sh cleanup node /app/dist-scheduler/cleanupReleases.js');
    expect(entrypoint).toContain('/bin/sh /app/docker/run-cron-command.sh musicbrainz-enrichment node /app/dist-scheduler/enrichMusicBrainzArtists.js');
    expect(entrypoint).toContain('FRESH_DROP_CRON_TIMEOUT_SECONDS=${CRAWLER_CRON_TIMEOUT_SECONDS}');
    expect(entrypoint).toContain('FRESH_DROP_CRON_TIMEOUT_SECONDS=${ENRICH_MUSICBRAINZ_CRON_TIMEOUT_SECONDS}');
    expect(entrypoint).toContain('FRESH_DROP_CRON_BLOCKED_BY=crawler');
    expect(entrypoint).not.toContain('yarn crawl:scheduled');
    expect(entrypoint).not.toContain('vite-node');
  });

  it('keeps tracked production MusicBrainz enrichment defaults conservative', () => {
    const productionEnvExample = readFileSync('.env.production.example', 'utf8');
    const compose = readFileSync('docker-compose.prod.yml', 'utf8');

    expect(productionEnvExample).toContain('ENRICH_MUSICBRAINZ_CRON_SCHEDULE=2-52/10 * * * *');
    expect(productionEnvExample).toContain('ENRICH_MUSICBRAINZ_LIMIT=100');
    expect(productionEnvExample).toContain('SPOTIFY_CRAWLER_SEARCH_TASK_COOLDOWN_MINUTES=2880');
    expect(productionEnvExample).not.toContain('ENRICH_MUSICBRAINZ_CRON_SCHEDULE=* * * * *');
    expect(productionEnvExample).not.toContain('ENRICH_MUSICBRAINZ_LIMIT=300');
    expect(compose).toContain('init: true');
    expect(compose).toContain('ENRICH_MUSICBRAINZ_CRON_SCHEDULE: ${ENRICH_MUSICBRAINZ_CRON_SCHEDULE:-2-52/10 * * * *}');
    expect(compose).toContain('ENRICH_MUSICBRAINZ_LIMIT: ${ENRICH_MUSICBRAINZ_LIMIT:-100}');
    expect(compose).toContain('SPOTIFY_CRAWLER_SEARCH_TASK_COOLDOWN_MINUTES: ${SPOTIFY_CRAWLER_SEARCH_TASK_COOLDOWN_MINUTES:-2880}');
  });

  it('builds scheduler jobs ahead of time instead of transpiling them in cron', () => {
    const packageJson = readFileSync('package.json', 'utf8');
    const buildConfig = readFileSync('vite.scheduler.config.ts', 'utf8');

    expect(packageJson).toContain('yarn build:scheduler');
    expect(buildConfig).toContain("crawlReleases: 'scripts/crawlReleases.ts'");
    expect(buildConfig).toContain("cleanupReleases: 'scripts/cleanupReleases.ts'");
    expect(buildConfig).toContain("enrichMusicBrainzArtists: 'scripts/enrichMusicBrainzArtists.ts'");
  });
});
