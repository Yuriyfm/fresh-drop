export type MusicBrainzGenre = {
  id?: string;
  name: string;
  count?: number;
  source: 'musicbrainz';
};

export function normalizeMusicBrainzGenres(input: unknown): MusicBrainzGenre[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const genresByName = new Map<string, MusicBrainzGenre>();

  for (const item of input) {
    if (!item || typeof item !== 'object') {
      continue;
    }

    const name = typeof item.name === 'string' ? item.name.trim() : '';

    if (!name) {
      continue;
    }

    const normalizedName = name.toLowerCase();
    const nextGenre: MusicBrainzGenre = {
      id: typeof item.id === 'string' && item.id.trim() ? item.id : undefined,
      name,
      count: typeof item.count === 'number' && Number.isFinite(item.count) ? item.count : 0,
      source: 'musicbrainz',
    };
    const existing = genresByName.get(normalizedName);

    if (!existing || (nextGenre.count ?? 0) > (existing.count ?? 0)) {
      genresByName.set(normalizedName, nextGenre);
    }
  }

  return Array.from(genresByName.values()).sort((left, right) => {
    const countDelta = (right.count ?? 0) - (left.count ?? 0);

    if (countDelta !== 0) {
      return countDelta;
    }

    return left.name.localeCompare(right.name);
  });
}

export function mergeGenreNames(spotifyGenres: string[], musicBrainzGenres: Array<Pick<MusicBrainzGenre, 'name'>>): string[] {
  const merged = new Set<string>();

  for (const genre of spotifyGenres) {
    const normalized = normalizeGenreName(genre);

    if (normalized) {
      merged.add(normalized);
    }
  }

  for (const genre of musicBrainzGenres) {
    const normalized = normalizeGenreName(genre.name);

    if (normalized) {
      merged.add(normalized);
    }
  }

  return Array.from(merged).sort((left, right) => left.localeCompare(right));
}

export function musicBrainzGenresToNames(genres: MusicBrainzGenre[]): string[] {
  return genres
    .map((genre) => normalizeGenreName(genre.name))
    .filter((genre): genre is string => Boolean(genre));
}

function normalizeGenreName(value: string): string {
  return value.trim().toLowerCase();
}
