import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Harness userData may contain installed third-party plugins with their own
    // test suites. They are runtime fixtures, not Canvas source tests.
    exclude: [...configDefaults.exclude, '**/.harness/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json-summary', 'html'],
      reportsDirectory: 'coverage',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.d.ts',
        'src/**/*.test.{ts,tsx}',
        'src/**/*.spec.{ts,tsx}',
        'src/**/__tests__/**',
      ],
    },
  },
});
