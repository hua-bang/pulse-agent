import { readdirSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

const ROOT_TEST_DIR = join(process.cwd(), 'src', 'main', '__tests__');

// Root-level tests must justify a process-wide seam: cross-domain behavior,
// packaging/runtime boundaries, or structural governance. Owner-local unit
// and integration tests belong beside the module or in <domain>/__tests__.
const ROOT_MAIN_TESTS = [
  'agent-session-send.test.ts',
  'agent-team-canvas-nodes.test.ts',
  'agent-tooling-package.test.ts',
  'bundle-boundaries.test.ts',
  'file-size-governance.test.ts',
  'import-boundaries.test.ts',
  'scheduled-run-notify.test.ts',
  'shell-path.test.ts',
  'test-locality-governance.test.ts',
  'ui-reuse-governance.test.ts',
];

describe('main test locality governance', () => {
  it('keeps the process-level test directory limited to cross-domain concerns', () => {
    const actual = readdirSync(ROOT_TEST_DIR)
      .sort();

    expect(actual).toEqual(ROOT_MAIN_TESTS);
  });
});
