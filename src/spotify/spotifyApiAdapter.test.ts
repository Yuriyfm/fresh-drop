import { describe, expect, it, vi } from 'vitest';
import { SpotifyApiAdapter, SpotifyApiError } from './spotifyApiAdapter';

describe('SpotifyApiAdapter', () => {
  it('gets an app token and fetches fresh releases for ingestion through tag:new', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(makeJsonResponse({ access_token: 'token-1', expires_in: 3600 }))
      .mockResolvedValueOnce(
        makeJsonResponse({
          albums: {
            items: [
              {
                id: 'album-1',
                name: 'Fresh Single',
                album_type: 'single',
                release_date: '2026-06-30',
                release_date_precision: 'day',
                external_urls: { spotify: 'https://open.spotify.com/album/album-1' },
                images: [{ url: 'https://image.example/cover.jpg' }],
                artists: [{ id: 'artist-1', name: 'Artist One' }],
              },
            ],
          },
        }),
      )
      .mockResolvedValueOnce(
        makeJsonResponse({
          artists: [{ id: 'artist-1', name: 'Artist One', genres: ['Pop'], popularity: 64 }],
        }),
      );

    const adapter = new SpotifyApiAdapter({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      fetchFn,
    });

    const releases = await adapter.fetchFreshReleasesFromSpotify({ limit: 10, market: 'US' });

    expect(fetchFn).toHaveBeenNthCalledWith(
      1,
      'https://accounts.spotify.com/api/token',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: `Basic ${btoa('client-id:client-secret')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        }),
      }),
    );
    expect(String(fetchFn.mock.calls[1][0])).toContain('/search?');
    expect(String(fetchFn.mock.calls[1][0])).toContain('q=tag%3Anew');
    expect(String(fetchFn.mock.calls[1][0])).toContain('type=album');
    expect(String(fetchFn.mock.calls[1][0])).toContain('market=US');
    expect(String(fetchFn.mock.calls[1][0])).toContain('offset=0');
    expect(String(fetchFn.mock.calls[2][0])).toContain('/artists?ids=artist-1');

    expect(releases).toEqual([
      expect.objectContaining({
        id: 'album-1',
        title: 'Fresh Single',
        type: 'single',
        genres: ['pop'],
        popularity: 64,
      }),
    ]);
  });

  it('fetches a raw search page for crawler dedupe-before-enrichment', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(makeJsonResponse({ access_token: 'token-1', expires_in: 3600 }))
      .mockResolvedValueOnce(
        makeJsonResponse({
          albums: {
            items: [
              {
                id: 'album-1',
                name: 'Fresh Single',
                album_type: 'single',
                release_date: '2026-06-30',
                release_date_precision: 'day',
                artists: [{ id: 'artist-1', name: 'Artist One' }],
              },
            ],
            total: 500,
            next: 'https://api.spotify.com/v1/search?offset=10',
          },
        }),
      );

    const adapter = new SpotifyApiAdapter({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      fetchFn,
    });

    await expect(adapter.fetchReleaseSearchAlbumsPage({
      query: 'tag:new',
      market: 'US',
      limit: 10,
      offset: 0,
    })).resolves.toEqual({
      albums: [
        expect.objectContaining({
          id: 'album-1',
          name: 'Fresh Single',
        }),
      ],
      total: 500,
      nextOffset: 10,
      requestCount: 2,
    });
  });

  it('returns an empty list when Spotify search has no album items', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(makeJsonResponse({ access_token: 'token-1', expires_in: 3600 }))
      .mockResolvedValueOnce(makeJsonResponse({ albums: { items: [] } }));

    const adapter = new SpotifyApiAdapter({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      fetchFn,
    });

    await expect(adapter.fetchFreshReleasesFromSpotify()).resolves.toEqual([]);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('skips releases that cannot be mapped to the domain model', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(makeJsonResponse({ access_token: 'token-1', expires_in: 3600 }))
      .mockResolvedValueOnce(
        makeJsonResponse({
          albums: {
            items: [
              { id: 'album-1', name: 'Valid Album', artists: [] },
              { id: 'album-2', artists: [] },
            ],
          },
        }),
      );

    const adapter = new SpotifyApiAdapter({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      fetchFn,
    });

    const releases = await adapter.fetchFreshReleasesFromSpotify();

    expect(releases).toHaveLength(1);
    expect(releases[0].id).toBe('album-1');
  });

  it('maps rate limits to a retryable adapter error', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(
      makeJsonResponse(
        { error: { message: 'Too many requests' } },
        {
          ok: false,
          status: 429,
          headers: new Headers({ 'retry-after': '7' }),
        },
      ),
    );

    const adapter = new SpotifyApiAdapter({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      fetchFn,
    });

    await expect(adapter.fetchFreshReleasesFromSpotify()).rejects.toMatchObject({
      code: 'rate_limited',
      status: 429,
      retryAfterSeconds: 7,
    });
  });

  it('returns partial search results when artist enrichment hits rate limit', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(makeJsonResponse({ access_token: 'token-1', expires_in: 3600 }))
      .mockResolvedValueOnce(
        makeJsonResponse({
          albums: {
            items: [
              {
                id: 'album-1',
                name: 'Fresh Single',
                album_type: 'single',
                release_date: '2026-06-30',
                release_date_precision: 'day',
                artists: [{ id: 'artist-1', name: 'Artist One' }],
              },
            ],
          },
        }),
      )
      .mockResolvedValueOnce(
        makeJsonResponse(
          { error: { message: 'Too many requests' } },
          {
            ok: false,
            status: 429,
            headers: new Headers({ 'retry-after': '7' }),
          },
        ),
      );

    const adapter = new SpotifyApiAdapter({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      fetchFn,
    });

    const page = await adapter.fetchReleaseSearchPage({ query: 'tag:new', market: 'US', limit: 50, offset: 0 });

    expect(page.releases).toHaveLength(1);
    expect(page.retryAfterSeconds).toBe(7);
    expect(page.requestCount).toBe(3);
    expect(page.releases[0]).toEqual(expect.objectContaining({
      id: 'album-1',
      title: 'Fresh Single',
    }));
  });

  it('maps network failures to adapter errors after retries are exhausted', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('network down'));
    const adapter = new SpotifyApiAdapter({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      fetchFn,
      sleepFn: vi.fn().mockResolvedValue(undefined),
    });

    const promise = adapter.fetchFreshReleasesFromSpotify();

    await expect(promise).rejects.toBeInstanceOf(SpotifyApiError);
    await expect(promise).rejects.toMatchObject({ code: 'network' });
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it('waits between Spotify requests according to the adaptive scheduler', async () => {
    let now = 0;
    const sleepFn = vi.fn().mockImplementation(async (delayMs: number) => {
      now += delayMs;
    });
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(makeJsonResponse({ access_token: 'token-1', expires_in: 3600 }))
      .mockImplementation(async () => {
        now += 10;
        return makeJsonResponse({
          albums: {
            items: [],
          },
        });
      });

    const adapter = new SpotifyApiAdapter({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      fetchFn,
      nowFn: () => now,
      sleepFn,
    });

    await adapter.fetchReleaseSearchAlbumsPage({ query: 'tag:new', market: 'US', limit: 50, offset: 0 });
    await adapter.fetchReleaseSearchAlbumsPage({ query: 'tag:new', market: 'US', limit: 50, offset: 50 });

    expect(sleepFn).toHaveBeenNthCalledWith(1, 1000);
    expect(sleepFn).toHaveBeenNthCalledWith(2, 990);
  });

  it('waits for the full retry-after window before the next Spotify request and lowers current rps', async () => {
    let now = 0;
    const sleepFn = vi.fn().mockImplementation(async (delayMs: number) => {
      now += delayMs;
    });
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(makeJsonResponse({ access_token: 'token-1', expires_in: 3600 }))
      .mockResolvedValueOnce(
        makeJsonResponse(
          { error: { message: 'Too many requests' } },
          {
            ok: false,
            status: 429,
            headers: new Headers({ 'retry-after': '7' }),
          },
        ),
      )
      .mockResolvedValueOnce(makeJsonResponse({ albums: { items: [] } }));

    const adapter = new SpotifyApiAdapter({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      fetchFn,
      nowFn: () => now,
      sleepFn,
      requestSchedulerConfig: {
        retryJitterMs: 0,
      },
    });

    await expect(adapter.fetchReleaseSearchAlbumsPage({ query: 'tag:new', market: 'US', limit: 50, offset: 0 })).rejects.toMatchObject({
      code: 'rate_limited',
      retryAfterSeconds: 7,
    });

    expect(adapter.getRequestSchedulerState().currentRps).toBe(0.5);

    await adapter.fetchReleaseSearchAlbumsPage({ query: 'tag:new', market: 'US', limit: 50, offset: 0 });

    expect(sleepFn).toHaveBeenNthCalledWith(1, 1000);
    expect(sleepFn).toHaveBeenNthCalledWith(2, 7000);
  });

  it('uses a conservative fallback delay when Spotify omits retry-after', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(makeJsonResponse({ access_token: 'token-1', expires_in: 3600 }))
      .mockResolvedValueOnce(
        makeJsonResponse(
          { error: { message: 'Too many requests' } },
          {
            ok: false,
            status: 429,
          },
        ),
      );

    const adapter = new SpotifyApiAdapter({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      fetchFn,
      requestSchedulerConfig: {
        retryJitterMs: 0,
      },
    });

    await expect(adapter.fetchFreshReleasesFromSpotify()).rejects.toMatchObject({
      code: 'rate_limited',
      status: 429,
      retryAfterSeconds: null,
    });
    expect(adapter.getRequestSchedulerState().cooldownUntil).toBeGreaterThan(0);
  });
});

function makeJsonResponse(
  body: unknown,
  options: { ok?: boolean; status?: number; headers?: Headers } = {},
): Response {
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    headers: options.headers ?? new Headers(),
    json: async () => body,
  } as Response;
}
