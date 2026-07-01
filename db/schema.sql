create table if not exists releases (
  id bigserial primary key,
  spotify_id text not null unique check (length(trim(spotify_id)) > 0),
  title text not null check (length(trim(title)) > 0),
  type text not null check (type in ('single', 'album', 'compilation', 'unknown')),
  release_date date,
  release_date_precision text not null check (release_date_precision in ('year', 'month', 'day', 'unknown')),
  spotify_url text,
  cover_url text,
  popularity integer check (popularity is null or (popularity >= 0 and popularity <= 100)),
  country text not null default 'unknown',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists artists (
  id bigserial primary key,
  spotify_id text not null unique check (length(trim(spotify_id)) > 0),
  name text not null check (length(trim(name)) > 0),
  popularity integer check (popularity is null or (popularity >= 0 and popularity <= 100)),
  country text not null default 'unknown',
  genres text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists release_artists (
  release_id bigint not null references releases(id) on delete cascade,
  artist_id bigint not null references artists(id) on delete cascade,
  position integer not null check (position >= 0),
  is_primary boolean not null default false,
  primary key (release_id, artist_id)
);

create table if not exists sync_runs (
  id bigserial primary key,
  started_at timestamptz not null,
  finished_at timestamptz,
  status text not null check (status in ('running', 'success', 'failed')),
  source text not null check (length(trim(source)) > 0),
  items_found integer not null default 0 check (items_found >= 0),
  items_saved integer not null default 0 check (items_saved >= 0),
  error_message text,
  created_at timestamptz not null default now(),
  check ((status = 'success' and error_message is null) or status <> 'success')
);

create index if not exists idx_releases_release_date on releases(release_date);
create index if not exists idx_releases_fresh_search on releases(release_date desc, popularity desc, spotify_id)
  where release_date_precision = 'day' and release_date is not null;
create index if not exists idx_releases_type on releases(type);
create index if not exists idx_releases_country on releases(country);
create index if not exists idx_releases_country_normalized on releases(lower(trim(country)));
create index if not exists idx_releases_popularity on releases(popularity);
create index if not exists idx_artists_genres on artists using gin(genres);
create index if not exists idx_release_artists_release_id on release_artists(release_id);
create index if not exists idx_release_artists_artist_id on release_artists(artist_id);
create index if not exists idx_sync_runs_started_at on sync_runs(started_at desc, id desc);
create unique index if not exists idx_release_artists_release_position on release_artists(release_id, position);
create unique index if not exists idx_release_artists_primary on release_artists(release_id) where is_primary;
