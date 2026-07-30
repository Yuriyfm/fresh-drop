import type { ArtistEnrichmentRepository } from '../data/artistEnrichmentRepository';
import { MusicBrainzApiError, type MusicBrainzClient } from '../integrations/musicbrainz/musicbrainzClient';

export type MusicBrainzArtistEnrichmentWorkerOptions = {
  enabled: boolean;
  limit: number;
  dryRun?: boolean;
  force?: boolean;
  urlLookupBatchSize: number;
  now?: Date;
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
};

export type MusicBrainzArtistEnrichmentWorkerSummary = {
  eligibleArtists: number;
  processedArtists: number;
  dryRun: boolean;
  force: boolean;
  urlLookupBatchSize: number;
  urlMatched: number;
  urlNotFound: number;
  urlAmbiguous: number;
  matched: number;
  notFound: number;
  ambiguous: number;
  failed: number;
  deferredDueToUpstream: number;
  artistGenresFetched: number;
  artistGenresEmpty: number;
  countriesSaved: number;
  countriesMissing: number;
  requestsTotal: number;
  durationMs: number;
};

export async function runMusicBrainzArtistEnrichmentWorker(
  client: MusicBrainzClient,
  repository: ArtistEnrichmentRepository,
  options: MusicBrainzArtistEnrichmentWorkerOptions,
): Promise<MusicBrainzArtistEnrichmentWorkerSummary> {
  const logger = options.logger ?? console;
  const now = options.now ?? new Date();
  const startedAt = Date.now();

  if (!options.enabled) {
    logger.info('MusicBrainz enrichment disabled.');

    return {
      eligibleArtists: 0,
      processedArtists: 0,
      dryRun: Boolean(options.dryRun),
      force: Boolean(options.force),
      urlLookupBatchSize: options.urlLookupBatchSize,
      urlMatched: 0,
      urlNotFound: 0,
      urlAmbiguous: 0,
      matched: 0,
      notFound: 0,
      ambiguous: 0,
      failed: 0,
      deferredDueToUpstream: 0,
      artistGenresFetched: 0,
      artistGenresEmpty: 0,
      countriesSaved: 0,
      countriesMissing: 0,
      requestsTotal: 0,
      durationMs: 0,
    };
  }

  const eligibleArtists = await repository.countArtistsForProcessing({ force: options.force, now });
  const artists = await repository.findArtistsForProcessing({ limit: options.limit, force: options.force, now });
  const summary: MusicBrainzArtistEnrichmentWorkerSummary = {
    eligibleArtists,
    processedArtists: artists.length,
    dryRun: Boolean(options.dryRun),
    force: Boolean(options.force),
    urlLookupBatchSize: options.urlLookupBatchSize,
    urlMatched: 0,
    urlNotFound: 0,
    urlAmbiguous: 0,
    matched: 0,
    notFound: 0,
    ambiguous: 0,
    failed: 0,
    deferredDueToUpstream: 0,
    artistGenresFetched: 0,
    artistGenresEmpty: 0,
    countriesSaved: 0,
    countriesMissing: 0,
    requestsTotal: 0,
    durationMs: 0,
  };

  logger.info(
    `MusicBrainz enrichment started: eligibleArtists=${eligibleArtists}` +
      ` limit=${options.limit}` +
      ` dryRun=${Boolean(options.dryRun)}` +
      ` force=${Boolean(options.force)}`,
  );

  const lookupResultsByUrl = new Map<string, Awaited<ReturnType<MusicBrainzClient['lookupSpotifyArtistUrls']>>[number]>();
  const failedArtistIds = new Set<string>();
  let upstreamFailure: unknown = null;

  for (const batch of chunk(artists, options.urlLookupBatchSize)) {
    if (upstreamFailure) {
      for (const artist of batch) {
        failedArtistIds.add(artist.spotifyArtistId);
        summary.failed += 1;
        summary.deferredDueToUpstream += 1;

        if (!options.dryRun) {
          await repository.markFailed(buildFailureInput(
            artist.spotifyArtistId,
            upstreamFailure,
            now,
            artist.matchStatus === 'matched',
          ));
        }
      }

      continue;
    }

    try {
      const lookupResults = await client.lookupSpotifyArtistUrls(batch.map((artist) => artist.spotifyArtistUrl));

      for (const result of lookupResults) {
        lookupResultsByUrl.set(result.spotifyArtistUrl, result);

        if (result.status === 'matched') {
          summary.urlMatched += 1;
        } else if (result.status === 'not_found') {
          summary.urlNotFound += 1;
        } else {
          summary.urlAmbiguous += 1;
        }
      }
    } catch (error) {
      for (const artist of batch) {
        failedArtistIds.add(artist.spotifyArtistId);
        summary.failed += 1;

        if (!options.dryRun) {
          await repository.markFailed(buildFailureInput(
            artist.spotifyArtistId,
            error,
            now,
            artist.matchStatus === 'matched',
          ));
        }
      }

      if (isRetryableMusicBrainzError(error)) {
        upstreamFailure = error;
        logCircuitBreaker(logger, error);
      }
    }
  }

  for (const artist of artists) {
    if (failedArtistIds.has(artist.spotifyArtistId)) {
      continue;
    }

    const lookup = lookupResultsByUrl.get(artist.spotifyArtistUrl);

    if (!lookup || lookup.status === 'not_found') {
      summary.notFound += 1;

      if (!options.dryRun) {
        await repository.markNotFound({ spotifyArtistId: artist.spotifyArtistId, fetchedAt: now });
      }

      continue;
    }

    if (lookup.status === 'ambiguous' || !lookup.musicBrainzArtistMbid) {
      summary.ambiguous += 1;

      if (!options.dryRun) {
        await repository.markAmbiguous({
          spotifyArtistId: artist.spotifyArtistId,
          fetchedAt: now,
          errorMessage: 'MusicBrainz URL lookup returned an ambiguous artist match.',
        });
      }

      continue;
    }

    if (upstreamFailure) {
      summary.failed += 1;
      summary.deferredDueToUpstream += 1;

      if (!options.dryRun) {
        await repository.markFailed(buildFailureInput(
          artist.spotifyArtistId,
          upstreamFailure,
          now,
          artist.matchStatus === 'matched',
        ));
      }

      continue;
    }

    try {
      const artistGenres = await client.lookupArtistGenres(lookup.musicBrainzArtistMbid);

      summary.matched += 1;
      summary.artistGenresFetched += 1;

      if (artistGenres.genres.length === 0) {
        summary.artistGenresEmpty += 1;
      }

      if (artistGenres.musicBrainzArtistCountry) {
        summary.countriesSaved += 1;
      } else {
        summary.countriesMissing += 1;
      }

      if (!options.dryRun) {
        await repository.markMatched({
          spotifyArtistId: artist.spotifyArtistId,
          musicBrainzArtistMbid: lookup.musicBrainzArtistMbid,
          musicBrainzArtistName: artistGenres.musicBrainzArtistName ?? lookup.musicBrainzArtistName,
          musicBrainzArtistCountry: artistGenres.musicBrainzArtistCountry,
          genres: artistGenres.genres,
          fetchedAt: now,
        });
      }
    } catch (error) {
      if (error instanceof MusicBrainzApiError && error.status === 404) {
        summary.notFound += 1;

        if (!options.dryRun) {
          await repository.markNotFound({ spotifyArtistId: artist.spotifyArtistId, fetchedAt: now });
        }

        continue;
      }

      summary.failed += 1;

      if (!options.dryRun) {
        await repository.markFailed(buildFailureInput(
          artist.spotifyArtistId,
          error,
          now,
          artist.matchStatus === 'matched',
        ));
      }

      if (isRetryableMusicBrainzError(error)) {
        upstreamFailure = error;
        logCircuitBreaker(logger, error);
      }
    }
  }

  summary.requestsTotal = client.getRequestCount();
  summary.durationMs = Date.now() - startedAt;

  if (!options.dryRun) {
    logger.info(
      `MusicBrainz data saved:` +
        ` matchedArtists=${summary.matched}` +
        ` notFoundArtists=${summary.notFound}` +
        ` ambiguousArtists=${summary.ambiguous}` +
        ` failedArtists=${summary.failed}` +
        ` deferredDueToUpstream=${summary.deferredDueToUpstream}` +
        ` genresFetched=${summary.artistGenresFetched}` +
        ` emptyGenrePayloads=${summary.artistGenresEmpty}` +
        ` countriesSaved=${summary.countriesSaved}` +
        ` countriesMissing=${summary.countriesMissing}`,
    );
  }

  logger.info(
    `MusicBrainz enrichment finished:` +
      ` processedArtists=${summary.processedArtists}` +
      ` urlMatched=${summary.urlMatched}` +
      ` urlNotFound=${summary.urlNotFound}` +
      ` urlAmbiguous=${summary.urlAmbiguous}` +
      ` matched=${summary.matched}` +
      ` notFound=${summary.notFound}` +
      ` ambiguous=${summary.ambiguous}` +
      ` failed=${summary.failed}` +
      ` deferredDueToUpstream=${summary.deferredDueToUpstream}` +
      ` artistGenresFetched=${summary.artistGenresFetched}` +
      ` artistGenresEmpty=${summary.artistGenresEmpty}` +
      ` countriesSaved=${summary.countriesSaved}` +
      ` countriesMissing=${summary.countriesMissing}` +
      ` requests=${summary.requestsTotal}` +
      ` durationMs=${summary.durationMs}`,
  );

  return summary;
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

function formatMusicBrainzError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return 'MusicBrainz request failed.';
}

function isRetryableMusicBrainzError(error: unknown): boolean {
  return !(error instanceof MusicBrainzApiError) || error.retryable;
}

function buildFailureInput(
  spotifyArtistId: string,
  error: unknown,
  now: Date,
  preserveMatchedStatus: boolean,
): {
  spotifyArtistId: string;
  errorMessage: string;
  now: Date;
  retryAt?: Date;
  preserveMatchedStatus?: boolean;
} {
  const retryAfterMs = error instanceof MusicBrainzApiError ? error.retryAfterMs : null;

  return {
    spotifyArtistId,
    errorMessage: formatMusicBrainzError(error),
    now,
    ...(retryAfterMs === null ? {} : { retryAt: new Date(now.getTime() + retryAfterMs) }),
    ...(preserveMatchedStatus ? { preserveMatchedStatus: true } : {}),
  };
}

function logCircuitBreaker(logger: Pick<Console, 'warn'>, error: unknown): void {
  const retryAfterMs = error instanceof MusicBrainzApiError ? error.retryAfterMs : null;

  logger.warn(
    `MusicBrainz upstream circuit opened:` +
      ` error=${formatMusicBrainzError(error)}` +
      ` retryAfterMs=${retryAfterMs ?? 'none'}`,
  );
}
