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

create table if not exists release_genres (
  release_id bigint not null references releases(id) on delete cascade,
  genre text not null check (length(trim(genre)) > 0),
  primary key (release_id, genre)
);

create table if not exists release_markets (
  release_id bigint not null references releases(id) on delete cascade,
  market text not null check (length(trim(market)) > 0),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (release_id, market)
);

create table if not exists genre_counts (
  genre text primary key check (length(trim(genre)) > 0),
  release_count integer not null default 0 check (release_count >= 0),
  updated_at timestamptz not null default now()
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

create table if not exists artist_enrichment (
  spotify_artist_id text primary key check (length(trim(spotify_artist_id)) > 0),
  spotify_artist_name text,
  spotify_artist_url text not null check (length(trim(spotify_artist_url)) > 0),
  musicbrainz_artist_mbid text,
  musicbrainz_artist_name text,
  musicbrainz_artist_country text,
  genres jsonb not null default '[]'::jsonb,
  match_status text not null check (match_status in ('pending', 'matched', 'not_found', 'ambiguous', 'failed', 'disabled')),
  match_method text check (match_method is null or match_method in ('spotify_url_lookup')),
  error_message text,
  fetched_at timestamptz,
  next_retry_at timestamptz,
  retry_count integer not null default 0 check (retry_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table artist_enrichment add column if not exists musicbrainz_artist_country text;

create table if not exists sync_tasks (
  id bigserial primary key,
  source text not null check (source in ('search', 'artist_albums')),
  query text not null check (length(trim(query)) > 0),
  market text not null check (length(trim(market)) > 0),
  offset_value integer not null default 0 check (offset_value >= 0),
  limit_value integer not null default 50 check (limit_value > 0),
  status text not null default 'pending' check (status in ('pending', 'running', 'completed', 'exhausted', 'failed', 'rate_limited')),
  priority integer not null default 100,
  attempts integer not null default 0 check (attempts >= 0),
  family text check (family is null or family in ('plain', 'album', 'artist', 'year_album', 'year_artist')),
  token text,
  depth integer not null default 0 check (depth >= 0),
  parent_query_id bigint references sync_tasks(id) on delete set null,
  items_found integer not null default 0 check (items_found >= 0),
  items_saved integer not null default 0 check (items_saved >= 0),
  spotify_total integer check (spotify_total is null or spotify_total >= 0),
  pages_fetched integer not null default 0 check (pages_fetched >= 0),
  items_seen integer not null default 0 check (items_seen >= 0),
  unique_added integer not null default 0 check (unique_added >= 0),
  duplicates_seen integer not null default 0 check (duplicates_seen >= 0),
  empty_pages integer not null default 0 check (empty_pages >= 0),
  last_offset integer check (last_offset is null or last_offset >= 0),
  avg_latency_ms integer check (avg_latency_ms is null or avg_latency_ms >= 0),
  rate_limited_count integer not null default 0 check (rate_limited_count >= 0),
  last_error text,
  completed_at timestamptz,
  was_split boolean not null default false,
  error_message text,
  next_run_at timestamptz not null default now(),
  last_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, query, market, offset_value)
);

alter table sync_tasks add column if not exists family text;
alter table sync_tasks add column if not exists token text;
alter table sync_tasks add column if not exists depth integer not null default 0;
alter table sync_tasks add column if not exists parent_query_id bigint references sync_tasks(id) on delete set null;
alter table sync_tasks add column if not exists spotify_total integer;
alter table sync_tasks add column if not exists pages_fetched integer not null default 0;
alter table sync_tasks add column if not exists items_seen integer not null default 0;
alter table sync_tasks add column if not exists unique_added integer not null default 0;
alter table sync_tasks add column if not exists duplicates_seen integer not null default 0;
alter table sync_tasks add column if not exists empty_pages integer not null default 0;
alter table sync_tasks add column if not exists last_offset integer;
alter table sync_tasks add column if not exists avg_latency_ms integer;
alter table sync_tasks add column if not exists rate_limited_count integer not null default 0;
alter table sync_tasks add column if not exists last_error text;
alter table sync_tasks add column if not exists completed_at timestamptz;
alter table sync_tasks add column if not exists was_split boolean not null default false;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'sync_tasks_status_check'
  ) then
    alter table sync_tasks drop constraint sync_tasks_status_check;
  end if;
end $$;

alter table sync_tasks
  add constraint sync_tasks_status_check
  check (status in ('pending', 'running', 'completed', 'exhausted', 'failed', 'rate_limited'));

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'sync_tasks_family_check'
  ) then
    alter table sync_tasks drop constraint sync_tasks_family_check;
  end if;
end $$;

alter table sync_tasks
  add constraint sync_tasks_family_check
  check (family is null or family in ('plain', 'album', 'artist', 'year_album', 'year_artist'));

create index if not exists idx_releases_release_date on releases(release_date);
create index if not exists idx_releases_fresh_search on releases(release_date desc, popularity desc, spotify_id)
  where release_date_precision = 'day' and release_date is not null;
create index if not exists idx_releases_type on releases(type);
create index if not exists idx_releases_country on releases(country);
create index if not exists idx_releases_country_normalized on releases(lower(trim(country)));
create index if not exists idx_releases_popularity on releases(popularity);
create index if not exists idx_artists_genres on artists using gin(genres);
create index if not exists idx_release_genres_genre on release_genres(genre);
create index if not exists idx_release_markets_market on release_markets(market, last_seen_at desc);
create index if not exists idx_genre_counts_release_count on genre_counts(release_count desc, genre);
create index if not exists idx_release_artists_release_id on release_artists(release_id);
create index if not exists idx_release_artists_artist_id on release_artists(artist_id);
create index if not exists idx_sync_runs_started_at on sync_runs(started_at desc, id desc);
create index if not exists idx_artist_enrichment_queue on artist_enrichment(match_status, next_retry_at, spotify_artist_id);
create index if not exists idx_artist_enrichment_mbid on artist_enrichment(musicbrainz_artist_mbid);
create index if not exists idx_sync_tasks_pending on sync_tasks(status, next_run_at, priority, id);
create unique index if not exists idx_release_artists_release_position on release_artists(release_id, position);
create unique index if not exists idx_release_artists_primary on release_artists(release_id) where is_primary;

insert into release_genres (release_id, genre)
select distinct
  ra.release_id,
  lower(trim(genre)) as genre
from release_artists ra
join artists a on a.id = ra.artist_id
cross join unnest(a.genres) as genre
where length(trim(genre)) > 0
on conflict do nothing;

insert into genre_counts (genre, release_count, updated_at)
select genre, count(*)::integer as release_count, now()
from release_genres
group by genre
on conflict (genre) do update set
  release_count = excluded.release_count,
  updated_at = now();

update genre_counts gc
set release_count = 0,
    updated_at = now()
where not exists (
  select 1
  from release_genres rg
  where rg.genre = gc.genre
);
