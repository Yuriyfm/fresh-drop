import { describe, expect, it } from 'vitest';
import { canSplitSearchShard, createChildSearchShardSeeds, createDefaultSearchShardSeeds } from './searchShard';

describe('createDefaultSearchShardSeeds', () => {
  it('includes ASCII defaults without market-specific extras by default', () => {
    const seeds = createDefaultSearchShardSeeds();

    expect(seeds).toEqual(expect.arrayContaining([
      expect.objectContaining({ family: 'plain', token: '', priority: 100, depth: 0 }),
      expect.objectContaining({ family: 'plain', token: 'a', priority: 100, depth: 1 }),
      expect.objectContaining({ family: 'plain', token: '0', priority: 100, depth: 1 }),
      expect.objectContaining({ family: 'album', token: 'a', priority: 90, depth: 1 }),
      expect.objectContaining({ family: 'artist', token: 'a', priority: 90, depth: 1 }),
    ]));
    expect(seeds).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ family: 'plain', token: 'ç' }),
    ]));
  });

  it('adds market-specific extra plain seeds for supported markets', () => {
    const seeds = createDefaultSearchShardSeeds(['TR', 'US', 'FR']);

    expect(seeds).toEqual(expect.arrayContaining([
      expect.objectContaining({ family: 'plain', token: 'ç', priority: 85, depth: 1, markets: ['TR', 'FR'] }),
      expect.objectContaining({ family: 'plain', token: 'ğ', priority: 85, depth: 1, markets: ['TR'] }),
      expect.objectContaining({ family: 'plain', token: 'ı', priority: 85, depth: 1, markets: ['TR'] }),
      expect.objectContaining({ family: 'plain', token: 'ö', priority: 85, depth: 1, markets: ['TR'] }),
      expect.objectContaining({ family: 'plain', token: 'ş', priority: 85, depth: 1, markets: ['TR'] }),
      expect.objectContaining({ family: 'plain', token: 'ü', priority: 85, depth: 1, markets: ['TR', 'FR'] }),
      expect.objectContaining({ family: 'plain', token: 'é', priority: 85, depth: 1, markets: ['FR'] }),
    ]));
  });
});

describe('canSplitSearchShard', () => {
  it('allows recursive split only for ASCII and digit tokens', () => {
    expect(canSplitSearchShard('plain', '')).toBe(true);
    expect(canSplitSearchShard('plain', 'ab')).toBe(true);
    expect(canSplitSearchShard('plain', '0')).toBe(true);
    expect(canSplitSearchShard('album', 'ab')).toBe(true);
    expect(canSplitSearchShard('artist', 'ab')).toBe(true);
    expect(canSplitSearchShard('plain', 'ç')).toBe(false);
    expect(canSplitSearchShard('plain', 'ş')).toBe(false);
    expect(canSplitSearchShard('year_album', '2026')).toBe(false);
  });
});

describe('createChildSearchShardSeeds', () => {
  it('does not create child shards for non-ASCII tokens', () => {
    expect(createChildSearchShardSeeds('plain', 'ç', 2)).toEqual([]);
  });
});
