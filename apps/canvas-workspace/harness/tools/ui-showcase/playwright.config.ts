import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

// Prefer an explicit override or the container-preinstalled Chromium when
// present (its revision can differ from what Playwright auto-probes for).
// On standard Linux CI runners where neither exists, fall back to Playwright's
// own installed browser.
const resolveChromiumExecutable = (): string | undefined => {
  const fromEnv = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?.trim();
  if (fromEnv) return fromEnv;
  const containerChromium = '/opt/pw-browsers/chromium';
  return existsSync(containerChromium) ? containerChromium : undefined;
};

const CHROMIUM_EXECUTABLE = resolveChromiumExecutable();

const PORT = 4319;

export default defineConfig({
  testDir: './tests',
  // The spec file is deliberately NOT named `*.spec.ts`/`*.test.ts` — that
  // pattern is vitest's default include glob too, and this repo's
  // `pnpm --filter canvas-workspace test` (vitest run) must stay untouched
  // (see AGENTS.md's "visual is opt-in" rule). Matching everything under
  // testDir is safe because testDir only contains this one file.
  testMatch: '**/*.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  snapshotPathTemplate: '{testDir}/__screenshots__/{testFilePath}/{arg}{ext}',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1200, height: 900 },
    deviceScaleFactor: 1,
    colorScheme: 'light',
    trace: 'off',
    video: 'off',
    screenshot: 'off',
  },
  expect: {
    toHaveScreenshot: {
      // Zero tolerance: the determinism proof this tool exists for is
      // "second run has zero diffs against the first's baseline" (see
      // README). Baselines are Linux-rendered only — fonts differ per OS,
      // so a macOS run will diff here and that is not a regression.
      maxDiffPixels: 0,
    },
  },
  projects: [
    {
      name: 'chromium-linux',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1200, height: 900 },
        deviceScaleFactor: 1,
        ...(CHROMIUM_EXECUTABLE
          ? { launchOptions: { executablePath: CHROMIUM_EXECUTABLE } }
          : {}),
      },
    },
  ],
  webServer: {
    // Production build served statically (`vite preview`), not the dev
    // server — no HMR client, no dev-only module graph timing, the most
    // deterministic of the two options the brief called out. Paths are
    // relative to this config file's directory (Playwright's webServer
    // default cwd), reaching into the workspace's own node_modules rather
    // than assuming `vite` is on PATH.
    command:
      '../../../node_modules/.bin/vite build && ../../../node_modules/.bin/vite preview --port ' +
      PORT +
      ' --strictPort --host 127.0.0.1',
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
