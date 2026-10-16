import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

const localChromium = '/opt/pw-browsers/chromium';

export default defineConfig({
  testDir: './e2e',
  outputDir: 'test-results/artifacts',
  timeout: 120000,
  reporter: [['list'], ['json', { outputFile: 'test-results/playwright.json' }]],
  use: {
    baseURL: 'http://localhost:4173',
    acceptDownloads: true,
    viewport: { width: 1366, height: 900 },
    launchOptions: existsSync(localChromium) ? { executablePath: localChromium } : {},
  },
  webServer: {
    command: 'npm run build && npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    timeout: 180000,
    reuseExistingServer: true,
  },
});
