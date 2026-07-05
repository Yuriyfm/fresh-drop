import type { PoolClient } from 'pg';

export async function rebuildReleaseGenresForArtistIds(client: PoolClient, spotifyArtistIds: string[]): Promise<void> {
  const uniqueArtistIds = Array.from(new Set(spotifyArtistIds.filter((artistId) => artistId.trim().length > 0)));

  if (uniqueArtistIds.length === 0) {
    return;
  }

  const releaseIdsResult = await client.query<{ release_id: string }>(
    `
      select distinct ra.release_id::text as release_id
      from release_artists ra
      join artists a on a.id = ra.artist_id
      where a.spotify_id = any($1::text[])
    `,
    [uniqueArtistIds],
  );

  await rebuildReleaseGenresForReleaseIds(client, releaseIdsResult.rows.map((row) => row.release_id));
}

export async function rebuildReleaseGenresForReleaseIds(client: PoolClient, releaseIds: string[]): Promise<void> {
  const uniqueReleaseIds = Array.from(new Set(releaseIds.filter((releaseId) => releaseId.trim().length > 0)));

  if (uniqueReleaseIds.length === 0) {
    return;
  }

  await decrementGenreCountsForReleaseIds(client, uniqueReleaseIds);
  await client.query('delete from release_genres where release_id = any($1::bigint[])', [uniqueReleaseIds]);
  await client.query(
    `
      insert into release_genres (release_id, genre)
      select distinct
        ra.release_id,
        lower(trim(merged.genre)) as genre
      from release_artists ra
      join artists a on a.id = ra.artist_id
      left join artist_enrichment ae
        on ae.spotify_artist_id = a.spotify_id
       and ae.match_status = 'matched'
      cross join lateral (
        select genre
        from (
          select unnest(a.genres) as genre
          union all
          select genre_item->>'name' as genre
          from jsonb_array_elements(coalesce(ae.genres, '[]'::jsonb)) as genre_item
        ) raw
        where length(trim(genre)) > 0
      ) as merged
      where ra.release_id = any($1::bigint[])
      on conflict do nothing
    `,
    [uniqueReleaseIds],
  );
  await incrementGenreCountsForReleaseIds(client, uniqueReleaseIds);
}

export async function decrementGenreCountsForReleaseIds(client: PoolClient, releaseIds: string[]): Promise<void> {
  if (releaseIds.length === 0) {
    return;
  }

  await client.query(
    `
      with deleted_counts as (
        select genre, count(*)::integer as release_count
        from release_genres
        where release_id = any($1::bigint[])
        group by genre
      )
      update genre_counts gc
      set release_count = greatest(gc.release_count - deleted_counts.release_count, 0),
          updated_at = now()
      from deleted_counts
      where gc.genre = deleted_counts.genre
    `,
    [releaseIds],
  );
}

async function incrementGenreCountsForReleaseIds(client: PoolClient, releaseIds: string[]): Promise<void> {
  if (releaseIds.length === 0) {
    return;
  }

  await client.query(
    `
      insert into genre_counts (genre, release_count, updated_at)
      select genre, count(*)::integer as release_count, now()
      from release_genres
      where release_id = any($1::bigint[])
      group by genre
      on conflict (genre) do update set
        release_count = genre_counts.release_count + excluded.release_count,
        updated_at = now()
    `,
    [releaseIds],
  );
}
