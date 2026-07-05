import type { ArtistEnrichmentQueueItem } from '../enrichment/artistEnrichment';
import type { MusicBrainzGenre } from '../integrations/musicbrainz/musicbrainzGenres';

export type ArtistEnrichmentStatus =
  | 'pending'
  | 'matched'
  | 'not_found'
  | 'ambiguous'
  | 'failed'
  | 'disabled';

export type ArtistEnrichmentCandidate = {
  spotifyArtistId: string;
  spotifyArtistName: string | null;
  spotifyArtistUrl: string;
  matchStatus: ArtistEnrichmentStatus;
  retryCount: number;
};

export type ArtistEnrichmentRepository = {
  countArtistsForProcessing(options: { force?: boolean; now?: Date }): Promise<number>;
  findArtistsForProcessing(options: { limit: number; force?: boolean; now?: Date }): Promise<ArtistEnrichmentCandidate[]>;
  markMatched(input: {
    spotifyArtistId: string;
    musicBrainzArtistMbid: string;
    musicBrainzArtistName?: string;
    genres: MusicBrainzGenre[];
    fetchedAt?: Date;
  }): Promise<void>;
  markNotFound(input: { spotifyArtistId: string; fetchedAt?: Date }): Promise<void>;
  markAmbiguous(input: { spotifyArtistId: string; fetchedAt?: Date; errorMessage?: string }): Promise<void>;
  markFailed(input: { spotifyArtistId: string; errorMessage: string; now?: Date }): Promise<void>;
};

export type ArtistEnrichmentQueueWriter = {
  queueArtists(
    artists: ArtistEnrichmentQueueItem[],
    options: { enabled: boolean },
  ): Promise<void>;
};
