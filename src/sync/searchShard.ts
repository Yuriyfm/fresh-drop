export type SearchShardFamily = 'plain' | 'album' | 'artist' | 'year_album' | 'year_artist';

export type SearchShardSeed = {
  family: SearchShardFamily;
  token: string;
  priority: number;
  depth: number;
  markets?: string[];
};

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz'.split('');
const DIGITS = '0123456789'.split('');
const EXTRA_PLAIN_TOKENS_PRIORITY = 85;
const MARKET_EXTRA_PLAIN_TOKENS: Record<string, string[]> = {
  AR: ['á', 'é', 'í', 'ó', 'ú', 'ü', 'ñ'],
  AL: ['ç', 'ë'],
  AM: 'աբգդեզէըթժիլխծկհձղճմյնշոչպջռսվտրցւփքօֆ'.split(''),
  AT: ['ä', 'ö', 'ü', 'ß'],
  AZ: ['ç', 'ə', 'ğ', 'ı', 'ö', 'ş', 'ü'],
  BE: ['à', 'â', 'æ', 'ç', 'é', 'è', 'ê', 'ë', 'î', 'ï', 'ô', 'œ', 'ù', 'û', 'ü', 'ÿ', 'é', 'ë', 'ï', 'ö', 'ü'],
  BG: 'абвгдежзийклмнопрстуфхцчшщъьюя'.split(''),
  BR: ['á', 'à', 'â', 'ã', 'ç', 'é', 'ê', 'í', 'ó', 'ô', 'õ', 'ú'],
  BY: 'абвгдеёжзійклмнопрстуўфхцчшыьэюя'.split(''),
  CA: ['à', 'â', 'æ', 'ç', 'é', 'è', 'ê', 'ë', 'î', 'ï', 'ô', 'œ', 'ù', 'û', 'ü', 'ÿ'],
  CH: ['à', 'â', 'æ', 'ç', 'é', 'è', 'ê', 'ë', 'î', 'ï', 'ô', 'œ', 'ù', 'û', 'ü', 'ÿ', 'ä', 'ö', 'ü', 'ß'],
  CO: ['á', 'é', 'í', 'ó', 'ú', 'ü', 'ñ'],
  CY: ['α', 'β', 'γ', 'δ', 'ε', 'ζ', 'η', 'θ', 'ι', 'κ', 'λ', 'μ', 'ν', 'ξ', 'ο', 'π', 'ρ', 'σ', 'ς', 'τ', 'υ', 'φ', 'χ', 'ψ', 'ω', 'ά', 'έ', 'ή', 'ί', 'ϊ', 'ΐ', 'ό', 'ύ', 'ϋ', 'ΰ', 'ώ'],
  CZ: ['á', 'č', 'ď', 'é', 'ě', 'í', 'ň', 'ó', 'ř', 'š', 'ť', 'ú', 'ů', 'ý', 'ž'],
  DE: ['ä', 'ö', 'ü', 'ß'],
  DK: ['æ', 'ø', 'å'],
  EE: ['õ', 'ä', 'ö', 'ü'],
  ES: ['á', 'é', 'í', 'ó', 'ú', 'ü', 'ñ'],
  FI: ['å', 'ä', 'ö'],
  FR: ['à', 'â', 'æ', 'ç', 'é', 'è', 'ê', 'ë', 'î', 'ï', 'ô', 'œ', 'ù', 'û', 'ü', 'ÿ'],
  GB: ['â', 'ê', 'î', 'ô', 'û', 'ŵ', 'ŷ', 'à', 'è', 'ì', 'ò', 'ù'],
  GE: 'აბგდევზთიკლმნოპჟრსტუფქღყშჩცძწჭხჯჰ'.split(''),
  GR: ['α', 'β', 'γ', 'δ', 'ε', 'ζ', 'η', 'θ', 'ι', 'κ', 'λ', 'μ', 'ν', 'ξ', 'ο', 'π', 'ρ', 'σ', 'ς', 'τ', 'υ', 'φ', 'χ', 'ψ', 'ω', 'ά', 'έ', 'ή', 'ί', 'ϊ', 'ΐ', 'ό', 'ύ', 'ϋ', 'ΰ', 'ώ'],
  HR: ['č', 'ć', 'đ', 'š', 'ž'],
  HU: ['á', 'é', 'í', 'ó', 'ö', 'ő', 'ú', 'ü', 'ű'],
  IE: ['á', 'é', 'í', 'ó', 'ú'],
  IS: ['á', 'ð', 'é', 'í', 'ó', 'ú', 'ý', 'þ', 'æ', 'ö'],
  IT: ['à', 'è', 'é', 'ì', 'í', 'î', 'ò', 'ó', 'ù', 'ú'],
  KZ: 'аәбвгғдеёжзийкқлмнңоөпрстуұүфхһцчшщъыіьэюя'.split(''),
  LT: ['ą', 'č', 'ę', 'ė', 'į', 'š', 'ų', 'ū', 'ž'],
  LV: ['ā', 'č', 'ē', 'ģ', 'ī', 'ķ', 'ļ', 'ņ', 'š', 'ū', 'ž'],
  MX: ['á', 'é', 'í', 'ó', 'ú', 'ü', 'ñ'],
  NL: ['é', 'è', 'ë', 'ï', 'ö', 'ü'],
  NO: ['æ', 'ø', 'å'],
  PL: ['ą', 'ć', 'ę', 'ł', 'ń', 'ó', 'ś', 'ź', 'ż'],
  PT: ['á', 'à', 'â', 'ã', 'ç', 'é', 'ê', 'í', 'ó', 'ô', 'õ', 'ú'],
  RS: ['č', 'ć', 'đ', 'š', 'ž', 'а', 'б', 'в', 'г', 'д', 'ђ', 'е', 'ж', 'з', 'и', 'ј', 'к', 'л', 'љ', 'м', 'н', 'њ', 'о', 'п', 'р', 'с', 'т', 'ћ', 'у', 'ф', 'х', 'ц', 'ч', 'џ', 'ш'],
  RU: 'абвгдеёжзийклмнопрстуфхцчшщъыьэюя'.split(''),
  SE: ['å', 'ä', 'ö'],
  TR: ['ç', 'ğ', 'ı', 'ö', 'ş', 'ü'],
  UA: 'абвгґдеєжзиіїйклмнопрстуфхцчшщьюя'.split(''),
};

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

export function createDefaultSearchShardSeeds(markets: string[] = []): SearchShardSeed[] {
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

  for (const seed of getMarketSpecificPlainTokens(markets)) {
    seeds.push(seed);
  }

  return seeds;
}

export function parseSearchShardSeeds(value: string): SearchShardSeed[] {
  return Array.from(new Set(value.split(',').map((item) => item.trim()).filter(Boolean))).map(parseSearchShardSeed);
}

export function createChildSearchShardSeeds(family: SearchShardFamily, token: string, nextDepth: number): SearchShardSeed[] {
  if (!canSplitSearchShard(family, token)) {
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

export function canSplitSearchShard(family: SearchShardFamily | null, token: string): boolean {
  if (family !== 'plain' && family !== 'album' && family !== 'artist') {
    return false;
  }

  if (!token) {
    return true;
  }

  return /^[a-z0-9]+$/.test(token);
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

function getMarketSpecificPlainTokens(markets: string[]): SearchShardSeed[] {
  const tokensByValue = new Map<string, SearchShardSeed>();

  for (const market of markets) {
    for (const token of MARKET_EXTRA_PLAIN_TOKENS[market] ?? []) {
      const normalizedToken = token.trim();

      if (!normalizedToken) {
        continue;
      }

      const existing = tokensByValue.get(normalizedToken);

      if (existing) {
        const supportedMarkets = new Set([...(existing.markets ?? []), market]);

        existing.markets = Array.from(supportedMarkets);
        continue;
      }

      tokensByValue.set(normalizedToken, {
        family: 'plain',
        token: normalizedToken,
        priority: EXTRA_PLAIN_TOKENS_PRIORITY,
        depth: 1,
        markets: [market],
      });
    }
  }

  return Array.from(tokensByValue.values());
}
