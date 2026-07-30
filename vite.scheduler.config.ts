import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    ssr: true,
    outDir: 'dist-scheduler',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        cleanupReleases: 'scripts/cleanupReleases.ts',
        crawlReleases: 'scripts/crawlReleases.ts',
        enrichMusicBrainzArtists: 'scripts/enrichMusicBrainzArtists.ts',
      },
    },
  },
});
