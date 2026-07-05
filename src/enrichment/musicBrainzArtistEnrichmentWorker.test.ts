import { describe, expect, it, vi } from 'vitest';
import type { ArtistEnrichmentRepository } from '../data/artistEnrichmentRepository';
import { getNextRetryAt } from '../data/postgresArtistEnrichmentRepository';
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
});

describe('getNextRetryAt', () => {
  it('uses the expected retry schedule', () => {
    const now = new Date('2026-07-05T12:00:00.000Z');

    expect(getNextRetryAt(now, 1).toISOString()).toBe('2026-07-05T12:15:00.000Z');
    expect(getNextRetryAt(now, 2).toISOString()).toBe('2026-07-05T13:00:00.000Z');
    expect(getNextRetryAt(now, 3).toISOString()).toBe('2026-07-05T18:00:00.000Z');
    expect(getNextRetryAt(now, 4).toISOString()).toBe('2026-07-06T12:00:00.000Z');
  });
});

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
      genres: [{ name: 'pop', count: 1, source: 'musicbrainz' }],
    }),
    getRequestCount: vi.fn().mockReturnValue(0),
    ...overrides,
  } as unknown as MusicBrainzClient;
}
