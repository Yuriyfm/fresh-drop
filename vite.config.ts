import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { createReleasesApiPlugin } from './src/api/releasesVitePlugin';
import { createMockReleaseRepository, createMockSyncRunRepository } from './src/dev/mockData';

const useMockData = process.env.FRESH_DROP_USE_MOCK_DATA === '1' || !process.env.DATABASE_URL;

export default defineConfig({
  plugins: [
    react(),
    createReleasesApiPlugin(
      useMockData
        ? {
            repository: createMockReleaseRepository(),
            syncRunRepository: createMockSyncRunRepository(),
          }
        : {},
    ),
  ],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
  },
});
