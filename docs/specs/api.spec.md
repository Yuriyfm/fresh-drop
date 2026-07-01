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
period=7d | 14d | 1m
genre=string
country=string
type=all | single | album | compilation
popularity=all | popular | less-known
page=number
limit=number
```

Rules:

* `period` is required and defaults to `7d` if omitted by the client.
* `type` defaults to `all`.
* `popularity` defaults to `all`.
* `page` starts at `1`.
* `limit` has a safe backend default and a backend maximum.
* filtering is performed by backend code against PostgreSQL data.

Sorting:

* MVP supports one default sort only: `Newest first`.
* The API does not accept a `sort` query parameter in the MVP.
* Popularity is used only as a tie-breaker for releases with the same date.
* If a UI sort switch is added later, this spec and `docs/specs/release-search.spec.md` must be updated first.

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
