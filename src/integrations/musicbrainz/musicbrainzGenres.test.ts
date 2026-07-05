import { describe, expect, it } from 'vitest';
import { mergeGenreNames, normalizeMusicBrainzGenres } from './musicbrainzGenres';

describe('normalizeMusicBrainzGenres', () => {
  it('normalizes, deduplicates, and sorts genres', () => {
    expect(normalizeMusicBrainzGenres([
      { id: '2', name: ' Pop ', count: 2 },
      { id: '1', name: 'pop', count: 5 },
      { id: '3', name: 'art pop', count: 5 },
      { id: '4', name: ' ', count: 100 },
      null,
    ])).toEqual([
      { id: '3', name: 'art pop', count: 5, source: 'musicbrainz' },
      { id: '1', name: 'pop', count: 5, source: 'musicbrainz' },
    ]);
  });
});

describe('mergeGenreNames', () => {
  it('merges Spotify genres with MusicBrainz genres without duplicates', () => {
    expect(mergeGenreNames(
      ['Pop', 'Alternative Pop'],
      [
        { name: 'pop' },
        { name: 'dance-pop' },
      ],
    )).toEqual(['alternative pop', 'dance-pop', 'pop']);
  });
});
