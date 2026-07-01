import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { createReleasesApiPlugin } from './src/api/releasesVitePlugin';

export default defineConfig({
  plugins: [react(), createReleasesApiPlugin()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
  },
});
