import type { Release } from '../domain/release';

export type ArtistEnrichmentQueueItem = {
  spotifyArtistId: string;
  spotifyArtistName: string;
  spotifyArtistUrl: string;
};

export function buildSpotifyArtistUrl(spotifyArtistId: string): string {
  return `https://open.spotify.com/artist/${spotifyArtistId}`;
}

export function extractUniqueSpotifyArtistsFromReleases(releases: Release[]): ArtistEnrichmentQueueItem[] {
  const artistsById = new Map<string, ArtistEnrichmentQueueItem>();

  for (const release of releases) {
    for (const artist of release.artists) {
      const spotifyArtistId = artist.id.trim();

      if (!spotifyArtistId) {
        continue;
      }

      artistsById.set(spotifyArtistId, {
        spotifyArtistId,
        spotifyArtistName: artist.name,
        spotifyArtistUrl: buildSpotifyArtistUrl(spotifyArtistId),
      });
    }
  }

  return Array.from(artistsById.values());
}
