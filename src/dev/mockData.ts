import { InMemoryReleaseRepository, type ReleaseRepository } from '../data/releaseRepository';
import type { SyncRunRepository } from '../data/syncRunRepository';
import type { ArtistSummary, Release, ReleaseType } from '../domain/release';

type MockReleaseSeed = {
  id: string;
  title: string;
  artist: string;
  type: ReleaseType;
  genres: string[];
  popularity: number;
  dayOffset: number;
  country?: string;
};

const mockReleaseSeeds: MockReleaseSeed[] = [
  { id: 'mock-001', title: 'Neon Drift', artist: 'Kairo Vale', type: 'album', genres: ['synthwave', 'electropop'], popularity: 71, dayOffset: 1, country: 'US' },
  { id: 'mock-002', title: 'Basement Gospel', artist: 'North Avenue Choir', type: 'single', genres: ['indie soul', 'alternative r&b'], popularity: 63, dayOffset: 2, country: 'GB' },
  { id: 'mock-003', title: 'Chrome Hearts, Late Nights', artist: 'Miko Saint', type: 'single', genres: ['hip hop', 'rap'], popularity: 84, dayOffset: 2, country: 'CA' },
  { id: 'mock-004', title: 'Lake Effect', artist: 'Sora Bloom', type: 'album', genres: ['dream pop', 'indie pop'], popularity: 58, dayOffset: 3, country: 'SE' },
  { id: 'mock-005', title: 'Pressure System', artist: 'Decimal Youth', type: 'compilation', genres: ['techno', 'minimal techno'], popularity: 68, dayOffset: 3, country: 'DE' },
  { id: 'mock-006', title: 'Blue Hour FM', artist: 'Isla Tempo', type: 'single', genres: ['house', 'deep house'], popularity: 76, dayOffset: 4, country: 'NL' },
  { id: 'mock-007', title: 'Mercy Signal', artist: 'Lina Crowe', type: 'single', genres: ['indie folk', 'singer-songwriter'], popularity: 55, dayOffset: 5, country: 'AU' },
  { id: 'mock-008', title: 'Ritual Damage', artist: 'Torchline', type: 'album', genres: ['metalcore', 'post-hardcore'], popularity: 72, dayOffset: 5, country: 'US' },
  { id: 'mock-009', title: 'Club Static', artist: 'Marta Flux', type: 'single', genres: ['bass house', 'bass music'], popularity: 74, dayOffset: 6, country: 'PL' },
  { id: 'mock-010', title: 'Quiet Weather', artist: 'Avery June', type: 'album', genres: ['bedroom pop', 'lo-fi'], popularity: 49, dayOffset: 6, country: 'NZ' },
  { id: 'mock-011', title: 'Palm Reader', artist: 'Yuto Gray', type: 'single', genres: ['alternative rock', 'indie rock'], popularity: 67, dayOffset: 7, country: 'JP' },
  { id: 'mock-012', title: 'Marble Rooms', artist: 'Nico Petal', type: 'single', genres: ['pop', 'dance pop'], popularity: 88, dayOffset: 8, country: 'US' },
  { id: 'mock-013', title: 'Jet Black Summer', artist: 'Roma Y', type: 'album', genres: ['rap', 'trap'], popularity: 82, dayOffset: 9, country: 'FR' },
  { id: 'mock-014', title: 'Echo Habitat', artist: 'Transit Choir', type: 'album', genres: ['ambient', 'electronica'], popularity: 46, dayOffset: 10, country: 'IS' },
  { id: 'mock-015', title: 'Silver Tongue Theory', artist: 'The Hollow Kids', type: 'single', genres: ['punk', 'pop punk'], popularity: 61, dayOffset: 10, country: 'US' },
  { id: 'mock-016', title: 'Soft Collapse', artist: 'Celine Argo', type: 'single', genres: ['alternative r&b', 'neo soul'], popularity: 69, dayOffset: 11, country: 'BE' },
  { id: 'mock-017', title: 'Orbit Manual', artist: 'Polar Twin', type: 'album', genres: ['electronic', 'downtempo'], popularity: 60, dayOffset: 12, country: 'DK' },
  { id: 'mock-018', title: 'Drive South', artist: 'Leon Mercer', type: 'single', genres: ['country', 'americana'], popularity: 57, dayOffset: 13, country: 'US' },
  { id: 'mock-019', title: 'Cedar Smoke', artist: 'Rin Solace', type: 'album', genres: ['folk', 'acoustic'], popularity: 53, dayOffset: 14, country: 'CA' },
  { id: 'mock-020', title: 'Heat Signature', artist: 'Nova District', type: 'single', genres: ['drum and bass', 'dance'], popularity: 77, dayOffset: 15, country: 'GB' },
  { id: 'mock-021', title: 'Velvet Wiring', artist: 'Mira Static', type: 'single', genres: ['trip hop', 'electronic'], popularity: 52, dayOffset: 17, country: 'ES' },
  { id: 'mock-022', title: 'Afterglow Policy', artist: 'Pine Arcade', type: 'album', genres: ['indie pop', 'synth-pop'], popularity: 65, dayOffset: 19, country: 'US' },
  { id: 'mock-023', title: 'Signal Fires Vol. 1', artist: 'Various Artists', type: 'compilation', genres: ['house', 'tech house'], popularity: 62, dayOffset: 22, country: 'DE' },
  { id: 'mock-024', title: 'Paper Moons', artist: 'Hana Field', type: 'single', genres: ['j-pop', 'pop'], popularity: 73, dayOffset: 26, country: 'JP' },
];

export function createMockReleaseRepository(currentDate: Date = new Date()): ReleaseRepository {
  const repository = new InMemoryReleaseRepository();

  void repository.saveReleases(mockReleaseSeeds.map((seed) => toRelease(seed, currentDate)));

  return repository;
}

export function createMockSyncRunRepository(currentDate: Date = new Date()): Pick<SyncRunRepository, 'getLatestSyncRun'> {
  const startedAt = new Date(currentDate.getTime() - 48 * 60 * 60 * 1000);
  const finishedAt = new Date(currentDate.getTime() - 47.5 * 60 * 60 * 1000);

  return {
    async getLatestSyncRun() {
      return {
        id: 'mock-sync-run-1',
        startedAt,
        finishedAt,
        status: 'success',
        source: 'mock-dev-seed',
        itemsFound: mockReleaseSeeds.length,
        itemsSaved: mockReleaseSeeds.length,
        errorMessage: null,
      };
    },
  };
}

function toRelease(seed: MockReleaseSeed, currentDate: Date): Release {
  const releaseDate = formatReleaseDate(currentDate, seed.dayOffset);
  const primaryArtist = createArtist(seed);

  return {
    id: seed.id,
    spotifyUrl: `https://open.spotify.com/album/${seed.id}`,
    coverUrl: null,
    title: seed.title,
    artists: [primaryArtist],
    primaryArtist,
    type: seed.type,
    releaseDate,
    releaseDatePrecision: 'day',
    genres: [...seed.genres],
    country: seed.country ?? 'unknown',
    popularity: seed.popularity,
  };
}

function createArtist(seed: MockReleaseSeed): ArtistSummary {
  return {
    id: `${seed.id}-artist`,
    name: seed.artist,
    genres: [...seed.genres],
    country: seed.country ?? 'unknown',
    popularity: seed.popularity,
  };
}

function formatReleaseDate(currentDate: Date, dayOffset: number): string {
  const releaseDate = new Date(Date.UTC(
    currentDate.getUTCFullYear(),
    currentDate.getUTCMonth(),
    currentDate.getUTCDate(),
  ));

  releaseDate.setUTCDate(releaseDate.getUTCDate() - dayOffset);

  return releaseDate.toISOString().slice(0, 10);
}
