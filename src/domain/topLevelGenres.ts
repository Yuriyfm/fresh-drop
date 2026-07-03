export const NO_GENRE_FILTER = '__no_genre__';

// Broad MVP shortcuts over Spotify/Every Noise-style microgenres, not a full taxonomy.
export const TOP_LEVEL_GENRES = [
  'pop',
  'rock',
  'hip hop',
  'rap',
  'electronic',
  'dance',
  'r&b',
  'soul',
  'jazz',
  'classical',
  'metal',
  'punk',
  'indie',
  'folk',
  'country',
  'latin',
  'reggae',
  'blues',
  'ambient',
  'soundtrack',
  'house',
  'techno',
  'disco',
  'funk',
] as const;

export type GenreOptionKind = 'general' | 'exact' | 'missing';

export function isNoGenreFilter(value: string): boolean {
  return value.trim().toLowerCase() === NO_GENRE_FILTER;
}

export function matchesGenreValue(releaseGenre: string, selectedGenre: string): boolean {
  const normalizedReleaseGenre = normalizeGenreText(releaseGenre);
  const normalizedSelectedGenre = normalizeGenreText(selectedGenre);

  if (!normalizedReleaseGenre || !normalizedSelectedGenre) {
    return false;
  }

  if (normalizedReleaseGenre === normalizedSelectedGenre) {
    return true;
  }

  return isTopLevelGenre(normalizedSelectedGenre) && normalizedReleaseGenre.includes(normalizedSelectedGenre);
}

export function isTopLevelGenre(genre: string): boolean {
  return TOP_LEVEL_GENRES.includes(normalizeGenreText(genre) as (typeof TOP_LEVEL_GENRES)[number]);
}

export function normalizeGenreText(value?: string): string {
  return value?.trim().toLowerCase() ?? '';
}
