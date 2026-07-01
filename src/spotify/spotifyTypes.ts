export type SpotifyImageDto = {
  url?: string;
};

export type SpotifyExternalUrlsDto = {
  spotify?: string;
};

export type SpotifyArtistDto = {
  id?: string;
  name?: string;
  genres?: string[];
  popularity?: number;
};

export type SpotifyAlbumDto = {
  id?: string;
  name?: string;
  album_type?: string;
  release_date?: string;
  release_date_precision?: string;
  external_urls?: SpotifyExternalUrlsDto;
  images?: SpotifyImageDto[];
  artists?: SpotifyArtistDto[];
};
