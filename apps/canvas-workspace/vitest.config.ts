import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Harness userData may contain installed third-party plugins with their own
    // test suites. They are runtime fixtures, not Canvas source tests.
    exclude: [...configDefaults.exclude, '**/.harness/**'],
  },
});
