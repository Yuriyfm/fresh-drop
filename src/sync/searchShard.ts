export type SearchShardFamily = 'plain' | 'album' | 'artist' | 'year_album' | 'year_artist';

export type SearchShardSeed = {
  family: SearchShardFamily;
  token: string;
  priority: number;
  depth: number;
};

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz'.split('');
const DIGITS = '0123456789'.split('');

export function buildSearchShardQuery(family: SearchShardFamily, token: string): string {
  if (family === 'plain') {
    return token ? `tag:new ${token}` : 'tag:new';
  }

  if (family === 'album') {
    return `tag:new album:${token}`;
  }

  if (family === 'artist') {
    return `tag:new artist:${token}`;
  }

  if (family === 'year_album') {
    return `tag:new year:${token} album:${token}`;
  }

  return `tag:new year:${token} artist:${token}`;
}

export function createDefaultSearchShardSeeds(): SearchShardSeed[] {
  const seeds: SearchShardSeed[] = [{ family: 'plain', token: '', priority: 100, depth: 0 }];

  for (const token of [...ALPHABET, ...DIGITS]) {
    seeds.push({
      family: 'plain',
      token,
      priority: 100,
      depth: token.length,
    });
  }

  for (const token of ALPHABET) {
    seeds.push({
      family: 'album',
      token,
      priority: 90,
      depth: 1,
    });
    seeds.push({
      family: 'artist',
      token,
      priority: 90,
      depth: 1,
    });
  }

  return seeds;
}

export function parseSearchShardSeeds(value: string): SearchShardSeed[] {
  return Array.from(new Set(value.split(',').map((item) => item.trim()).filter(Boolean))).map(parseSearchShardSeed);
}

export function createChildSearchShardSeeds(family: SearchShardFamily, token: string, nextDepth: number): SearchShardSeed[] {
  if (family !== 'plain' && family !== 'album' && family !== 'artist') {
    return [];
  }

  return ALPHABET.map((suffix) => ({
    family,
    token: `${token}${suffix}`,
    priority: getInitialChildPriority(nextDepth),
    depth: nextDepth,
  }));
}

export function getInitialChildPriority(depth: number): number {
  return Math.max(1, 80 - depth);
}

export function getSearchShardPriority(depth: number, uniqueAdded: number, duplicateRate: number, spotifyTotal: number | null): number {
  const saturatedBonus = spotifyTotal !== null && spotifyTotal >= 950 ? 20 : 0;
  const priority = 50 + Math.min(uniqueAdded, 100) - duplicateRate * 30 + saturatedBonus - depth * 5;

  return Math.max(1, Math.round(priority));
}

function parseSearchShardSeed(query: string): SearchShardSeed {
  if (query === 'tag:new') {
    return { family: 'plain', token: '', priority: 100, depth: 0 };
  }

  const albumMatch = query.match(/^tag:new album:([a-z]+)$/);

  if (albumMatch) {
    return { family: 'album', token: albumMatch[1], priority: albumMatch[1].length === 1 ? 90 : getInitialChildPriority(albumMatch[1].length), depth: albumMatch[1].length };
  }

  const artistMatch = query.match(/^tag:new artist:([a-z]+)$/);

  if (artistMatch) {
    return { family: 'artist', token: artistMatch[1], priority: artistMatch[1].length === 1 ? 90 : getInitialChildPriority(artistMatch[1].length), depth: artistMatch[1].length };
  }

  const plainMatch = query.match(/^tag:new ([a-z0-9]+)$/);

  if (plainMatch) {
    return { family: 'plain', token: plainMatch[1], priority: plainMatch[1].length === 1 ? 100 : getInitialChildPriority(plainMatch[1].length), depth: plainMatch[1].length };
  }

  throw new Error('SPOTIFY_CRAWLER_SEARCH_QUERIES must contain tag:new, tag:new <token>, tag:new album:<token>, or tag:new artist:<token>.');
}
