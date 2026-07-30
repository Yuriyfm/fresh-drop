import { describe, expect, it, vi } from 'vitest';
import type { ArtistEnrichmentRepository } from '../data/artistEnrichmentRepository';
import { getEffectiveRetryAt, getNextRetryAt, getRefreshAt } from '../data/postgresArtistEnrichmentRepository';
import { MusicBrainzApiError, type MusicBrainzClient } from '../integrations/musicbrainz/musicbrainzClient';
import { runMusicBrainzArtistEnrichmentWorker } from './musicBrainzArtistEnrichmentWorker';

describe('runMusicBrainzArtistEnrichmentWorker', () => {
  it('does not refetch matched artists without force', async () => {
    const repository = makeRepository([
      {
        spotifyArtistId: 'artist-1',
        spotifyArtistName: 'Artist One',
        spotifyArtistUrl: 'https://open.spotify.com/artist/artist-1',
        matchStatus: 'matched',
        retryCount: 0,
      },
    ]);
    const client = makeClient();

    const summary = await runMusicBrainzArtistEnrichmentWorker(client, repository, {
      enabled: true,
      limit: 10,
      urlLookupBatchSize: 100,
    });

    expect(summary.processedArtists).toBe(0);
    expect(client.lookupSpotifyArtistUrls).not.toHaveBeenCalled();
  });

  it('stores the MusicBrainz country for matched artists', async () => {
    const repository = makeRepository([
      {
        spotifyArtistId: 'artist-1',
        spotifyArtistName: 'Artist One',
        spotifyArtistUrl: 'https://open.spotify.com/artist/artist-1',
        matchStatus: 'pending',
        retryCount: 0,
      },
    ]);
    const client = makeClient({
      lookupSpotifyArtistUrls: vi.fn().mockResolvedValue([{
        spotifyArtistUrl: 'https://open.spotify.com/artist/artist-1',
        status: 'matched',
        musicBrainzArtistMbid: 'mbid-1',
        musicBrainzArtistName: 'Artist One',
      }]),
      lookupArtistGenres: vi.fn().mockResolvedValue({
        musicBrainzArtistMbid: 'mbid-1',
        musicBrainzArtistName: 'Artist One',
        musicBrainzArtistCountry: 'United States',
        genres: [{ name: 'pop', count: 1, source: 'musicbrainz' }],
      }),
    });

    const summary = await runMusicBrainzArtistEnrichmentWorker(client, repository, {
      enabled: true,
      limit: 10,
      urlLookupBatchSize: 100,
      now: new Date('2026-07-05T12:00:00.000Z'),
    });

    expect(summary.matched).toBe(1);
    expect(summary.countriesSaved).toBe(1);
    expect(summary.countriesMissing).toBe(0);
    expect(repository.markMatched).toHaveBeenCalledWith({
      spotifyArtistId: 'artist-1',
      musicBrainzArtistMbid: 'mbid-1',
      musicBrainzArtistName: 'Artist One',
      musicBrainzArtistCountry: 'United States',
      genres: [{ name: 'pop', count: 1, source: 'musicbrainz' }],
      fetchedAt: new Date('2026-07-05T12:00:00.000Z'),
    });
  });

  it('marks temporary artist lookup errors as failed', async () => {
    const repository = makeRepository([
      {
        spotifyArtistId: 'artist-1',
        spotifyArtistName: 'Artist One',
        spotifyArtistUrl: 'https://open.spotify.com/artist/artist-1',
        matchStatus: 'pending',
        retryCount: 0,
      },
    ]);
    const client = makeClient({
      lookupSpotifyArtistUrls: vi.fn().mockResolvedValue([{
        spotifyArtistUrl: 'https://open.spotify.com/artist/artist-1',
        status: 'matched',
        musicBrainzArtistMbid: 'mbid-1',
      }]),
      lookupArtistGenres: vi.fn().mockRejectedValue(new MusicBrainzApiError('MusicBrainz request failed with status 503.', 503, true)),
    });

    const summary = await runMusicBrainzArtistEnrichmentWorker(client, repository, {
      enabled: true,
      limit: 10,
      urlLookupBatchSize: 100,
      now: new Date('2026-07-05T12:00:00.000Z'),
    });

    expect(summary.failed).toBe(1);
    expect(repository.markFailed).toHaveBeenCalledWith({
      spotifyArtistId: 'artist-1',
      errorMessage: 'MusicBrainz request failed with status 503.',
      now: new Date('2026-07-05T12:00:00.000Z'),
    });
  });

  it('marks network errors as failed after batch lookup', async () => {
    const repository = makeRepository([
      {
        spotifyArtistId: 'artist-1',
        spotifyArtistName: 'Artist One',
        spotifyArtistUrl: 'https://open.spotify.com/artist/artist-1',
        matchStatus: 'pending',
        retryCount: 0,
      },
    ]);
    const client = makeClient({
      lookupSpotifyArtistUrls: vi.fn().mockRejectedValue(new Error('socket hang up')),
    });

    const summary = await runMusicBrainzArtistEnrichmentWorker(client, repository, {
      enabled: true,
      limit: 10,
      urlLookupBatchSize: 100,
      now: new Date('2026-07-05T12:00:00.000Z'),
    });

    expect(summary.failed).toBe(1);
    expect(summary.notFound).toBe(0);
    expect(repository.markFailed).toHaveBeenCalledWith({
      spotifyArtistId: 'artist-1',
      errorMessage: 'socket hang up',
      now: new Date('2026-07-05T12:00:00.000Z'),
    });
  });

  it('stops artist requests and defers remaining matches after a retryable error', async () => {
    const repository = makeRepository([
      makeCandidate('artist-1'),
      makeCandidate('artist-2'),
      makeCandidate('artist-3'),
    ]);
    const retryableError = new MusicBrainzApiError(
      'MusicBrainz request failed with status 429.',
      429,
      true,
      30 * 60 * 1000,
    );
    const lookupArtistGenres = vi.fn()
      .mockRejectedValueOnce(retryableError)
      .mockResolvedValue({
        musicBrainzArtistMbid: 'mbid-2',
        musicBrainzArtistName: 'Artist Two',
        musicBrainzArtistCountry: 'Germany',
        genres: [],
      });
    const client = makeClient({
      lookupSpotifyArtistUrls: vi.fn().mockResolvedValue(
        ['artist-1', 'artist-2', 'artist-3'].map((id) => ({
          spotifyArtistUrl: `https://open.spotify.com/artist/${id}`,
          status: 'matched',
          musicBrainzArtistMbid: `mbid-${id.slice(-1)}`,
        })),
      ),
      lookupArtistGenres,
    });
    const now = new Date('2026-07-05T12:00:00.000Z');

    const summary = await runMusicBrainzArtistEnrichmentWorker(client, repository, {
      enabled: true,
      limit: 10,
      urlLookupBatchSize: 100,
      now,
    });

    expect(lookupArtistGenres).toHaveBeenCalledTimes(1);
    expect(summary.failed).toBe(3);
    expect(summary.deferredDueToUpstream).toBe(2);
    expect(repository.markFailed).toHaveBeenCalledTimes(3);
    expect(repository.markFailed).toHaveBeenLastCalledWith({
      spotifyArtistId: 'artist-3',
      errorMessage: 'MusicBrainz request failed with status 429.',
      now,
      retryAt: new Date('2026-07-05T12:30:00.000Z'),
    });
  });

  it('preserves an existing matched result when its refresh fails temporarily', async () => {
    const repository = makeRepository([{
      ...makeCandidate('artist-1'),
      matchStatus: 'matched',
    }]);
    const client = makeClient({
      lookupSpotifyArtistUrls: vi.fn().mockResolvedValue([{
        spotifyArtistUrl: 'https://open.spotify.com/artist/artist-1',
        status: 'matched',
        musicBrainzArtistMbid: 'mbid-1',
      }]),
      lookupArtistGenres: vi.fn().mockRejectedValue(
        new MusicBrainzApiError('MusicBrainz request timed out.', null, true),
      ),
    });
    const now = new Date('2026-07-05T12:00:00.000Z');

    await runMusicBrainzArtistEnrichmentWorker(client, repository, {
      enabled: true,
      force: true,
      limit: 10,
      urlLookupBatchSize: 100,
      now,
    });

    expect(repository.markFailed).toHaveBeenCalledWith({
      spotifyArtistId: 'artist-1',
      errorMessage: 'MusicBrainz request timed out.',
      now,
      preserveMatchedStatus: true,
    });
  });
});

describe('getNextRetryAt', () => {
  it('uses the expected retry schedule', () => {
    const now = new Date('2026-07-05T12:00:00.000Z');

    expect(getNextRetryAt(now, 1).toISOString()).toBe('2026-07-05T12:15:00.000Z');
    expect(getNextRetryAt(now, 2).toISOString()).toBe('2026-07-05T13:00:00.000Z');
    expect(getNextRetryAt(now, 3).toISOString()).toBe('2026-07-05T18:00:00.000Z');
    expect(getNextRetryAt(now, 4).toISOString()).toBe('2026-07-06T12:00:00.000Z');
  });

  it('does not let Retry-After shorten local backoff', () => {
    const now = new Date('2026-07-05T12:00:00.000Z');

    expect(getEffectiveRetryAt(now, 1, new Date('2026-07-05T12:01:00.000Z')).toISOString())
      .toBe('2026-07-05T12:15:00.000Z');
    expect(getEffectiveRetryAt(now, 1, new Date('2026-07-05T13:00:00.000Z')).toISOString())
      .toBe('2026-07-05T13:00:00.000Z');
  });

  it('refreshes missing MusicBrainz data after 30 days', () => {
    expect(getRefreshAt(new Date('2026-07-05T12:00:00.000Z')).toISOString())
      .toBe('2026-08-04T12:00:00.000Z');
  });
});

function makeCandidate(spotifyArtistId: string): Awaited<ReturnType<ArtistEnrichmentRepository['findArtistsForProcessing']>>[number] {
  return {
    spotifyArtistId,
    spotifyArtistName: spotifyArtistId,
    spotifyArtistUrl: `https://open.spotify.com/artist/${spotifyArtistId}`,
    matchStatus: 'pending',
    retryCount: 0,
  };
}

function makeRepository(candidates: Awaited<ReturnType<ArtistEnrichmentRepository['findArtistsForProcessing']>>): ArtistEnrichmentRepository & {
  markMatched: ReturnType<typeof vi.fn>;
  markNotFound: ReturnType<typeof vi.fn>;
  markAmbiguous: ReturnType<typeof vi.fn>;
  markFailed: ReturnType<typeof vi.fn>;
} {
  const getEligibleCandidates = (force?: boolean) => force
    ? candidates.filter((candidate) => candidate.matchStatus !== 'disabled')
    : candidates.filter((candidate) => candidate.matchStatus === 'pending' || candidate.matchStatus === 'failed');

  return {
    countArtistsForProcessing: vi.fn().mockImplementation(async ({ force }: { force?: boolean }) => getEligibleCandidates(force).length),
    findArtistsForProcessing: vi.fn().mockImplementation(async ({ force }: { force?: boolean }) => getEligibleCandidates(force)),
    markMatched: vi.fn().mockResolvedValue(undefined),
    markNotFound: vi.fn().mockResolvedValue(undefined),
    markAmbiguous: vi.fn().mockResolvedValue(undefined),
    markFailed: vi.fn().mockResolvedValue(undefined),
  };
}

function makeClient(overrides: Partial<MusicBrainzClient> = {}): MusicBrainzClient {
  return {
    lookupSpotifyArtistUrls: vi.fn().mockResolvedValue([]),
    lookupArtistGenres: vi.fn().mockResolvedValue({
      musicBrainzArtistMbid: 'mbid-1',
      musicBrainzArtistName: 'Artist One',
      musicBrainzArtistCountry: undefined,
      genres: [{ name: 'pop', count: 1, source: 'musicbrainz' }],
    }),
    getRequestCount: vi.fn().mockReturnValue(0),
    ...overrides,
  } as unknown as MusicBrainzClient;
}
