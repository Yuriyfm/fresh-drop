# Backend API Spec

## Scope

This spec fixes the MVP backend contract between frontend and the application's data layer.

Frontend must not call Spotify API directly for release search. Spotify API is used only by sync / ingestion code that writes normalized data to PostgreSQL.

## Data flow

```text
Spotify API
  -> sync / ingestion
  -> PostgreSQL
  -> backend API
  -> frontend
```

## GET /api/releases

Returns normalized releases from the application database.

### Query parameters

```text
period=today | 1d..30d | 0-30d | 1m
genre=string
type=all | single | album | compilation
popularityMin=number
popularityMax=number
sort=newest | oldest | popular | less-popular
randomStartSeed=string
page=number
limit=number
```

Rules:

* `period` is required and defaults to `7d` if omitted by the client.
* custom daily periods use the `Nd` form, where `N` is an integer from `1` through `30`.
* bounded ranges use the `N-Md` form, where both bounds are integer day offsets and `0 <= N <= M <= 30`.
* `type` defaults to `all`.
* `popularityMin` and `popularityMax` are optional inclusive bounds from `0` to `100`; releases with `null` popularity do not match bounded popularity filters.
* `sort` defaults to `newest`.
* `randomStartSeed` is optional and is used only to keep the default unfiltered start offset stable across pagination.
* `page` starts at `1`.
* `limit` has a safe backend default and a backend maximum.
* filtering is performed by backend code against PostgreSQL data.

Sorting:

* `newest` sorts by release date descending.
* `oldest` sorts by release date ascending.
* `popular` sorts by popularity descending without date as the primary order.
* `less-popular` sorts by popularity ascending without date as the primary order.
* Only one sort is active at a time.

### Success response

```ts
type ReleasesApiResponse = {
  items: Release[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    hasNextPage: boolean;
  };
  error: null;
};
```

### Error response

```ts
type ReleasesApiErrorResponse = {
  items: [];
  pagination: {
    page: number;
    limit: number;
    total: 0;
    hasNextPage: false;
  };
  error: {
    code: 'invalid_query' | 'internal_error';
    message: string;
  };
};
```

## Production HTTPS

Production traffic is encrypted with HTTPS terminated by Caddy. Ports 80 and the
legacy HTTP port 8081 redirect to the canonical HTTPS address on port 443,
preserving the request path and query. Caddy manages public Let's Encrypt
certificates and renewal, using the `shortlived` ACME profile to support public IP
addresses as well as domains. Certificate state persists in `caddy_data`.
`FRESH_DROP_SITE_ADDRESS` must contain the public IP or domain, without a scheme
or port. The app and PostgreSQL remain reachable only inside the Compose network.

## Production overload protection

* All `/api` and `/api/*` requests share an in-memory fixed 60-second window:
  at most 60 admitted requests per client IP and 300 admitted requests in total.
* At most 8 API handlers run concurrently. Excess requests are rejected immediately,
  before database access, without queueing. Slots are released when handlers settle,
  including failures; disconnecting a client does not release a still-running query.
* Rejected requests return HTTP `429`, `Cache-Control: no-store`, `Retry-After`
  (whole seconds until the window resets, or 1 second for concurrency exhaustion),
  and `{ error: { code: 'rate_limited', message: string } }`.
  This common overload response takes precedence over endpoint-specific shapes.
* Static frontend files are not counted. The development Vite server is unaffected.
* `API_RATE_LIMIT_PER_IP`, `API_RATE_LIMIT_GLOBAL`, and `API_MAX_CONCURRENT_REQUESTS`
  override defaults with positive integers. Invalid configuration fails startup.
* Client identity defaults to the socket IP. Production Compose enables
  `API_TRUST_PROXY_HEADER=true`: Caddy overwrites `X-Fresh-Drop-Client-IP` with
  the connection's remote IP, and the app port is not published. User-supplied
  `X-Forwarded-For` is never used. Do not enable this mode on a directly exposed app.
* Counters reset on process restart and each window boundary. The IP map stores
  only admitted clients and therefore has at most the global limit's entry count.
  These limits apply to one app process; a multi-instance deployment needs shared state.
* This protects API/database capacity during traffic bursts, not network bandwidth
  against a volumetric DDoS. Multiple people behind one public IP share its limit.

## Responsibilities

Backend API:

* reads from PostgreSQL, not Spotify;
* applies filters and pagination server-side;
* returns domain-shaped release data suitable for UI;
* hides Spotify DTO details from frontend.

Spotify adapter:

* fetches fresh release data from Spotify for sync / ingestion;
* maps Spotify DTOs to normalized release data;
* does not serve user search requests at runtime.

## GET /api/insights

Returns discovery statistics for the Insights page.

### Query parameters

```text
period=7 | 14 | 30
type=all | single | album
```

Rules:

* `period` defaults to `30`.
* `type` defaults to `all`.
* calculations use the same normalized release data as `GET /api/releases`;
* public country / genre / scene cards exclude unknown, empty, and null country or genre values;
* `bigArtistsFromSmallScenes` and `deepUndergroundDrops` items include a matching `release` snapshot and `query.releaseId` so the frontend can open release details directly;
* response returns all MVP cards in one request.

### Success response

```ts
type InsightsApiResponse = {
  period: 7 | 14 | 30;
  type: 'all' | 'single' | 'album';
  generatedAt: string;
  sections: {
    countries: {
      mostActiveCountries: {
        byReleases: InsightListItem[];
        byArtists: InsightListItem[];
      };
      rareCountries: InsightListItem[];
      bigArtistsFromSmallScenes: InsightListItem[];
      mostDiverseCountries: InsightListItem[];
    };
    genres: {
      mostActiveGenres: InsightListItem[];
      rareGenreDrops: InsightListItem[];
      mostMainstreamGenres: InsightListItem[];
      deepUndergroundGenres: InsightListItem[];
    };
    scenes: {
      topScenes: InsightListItem[];
    };
    discovery: {
      deepUndergroundDrops: InsightListItem[];
    };
  };
  error: null;
};
```

### Error response

Uses the same `invalid_query` / `internal_error` error shape as release endpoints and returns empty card arrays.

## GET /api/sync-runs/latest

Returns the latest sync run for development/debug monitoring.

This endpoint is read-only and is not an admin UI. It must not trigger sync, mutate data, or expose Spotify credentials.

### Success response

```ts
type LatestSyncRunApiResponse = {
  item: {
    id: string;
    startedAt: string;
    finishedAt: string | null;
    status: 'running' | 'success' | 'failed';
    source: string;
    itemsFound: number;
    itemsSaved: number;
    errorMessage: string | null;
  } | null;
  error: null;
};
```

`item = null` means sync has not run yet or the `sync_runs` table is empty.

### Error response

```ts
type LatestSyncRunApiErrorResponse = {
  item: null;
  error: {
    code: 'internal_error';
    message: string;
  };
};
```
