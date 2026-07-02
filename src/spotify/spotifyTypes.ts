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

export type SpotifySearchAlbumsResponseDto = {
  albums?: {
    items?: SpotifyAlbumDto[];
    total?: number;
    next?: string | null;
  };
};

export type SpotifyAlbumsPageResponseDto = {
  items?: SpotifyAlbumDto[];
  total?: number;
  next?: string | null;
};

export type SpotifyTokenResponseDto = {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
};

export type SpotifyArtistsResponseDto = {
  artists?: SpotifyArtistDto[];
};
