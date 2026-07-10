import { test, expect, type Page, type Locator } from '@playwright/test';

// Visual-regression baseline for apps/canvas-workspace's components/ui/
// (the "blessed" design-system set). See
// apps/canvas-workspace/harness/tools/ui-showcase/README.md for how to run
// and update this, and docs/ui-reuse-burndown.md's Batch C3 section for why
// it exists. Not named `*.spec.ts`/`*.test.ts` on purpose — see
// playwright.config.ts's `testMatch` comment (vitest's default include glob
// must never pick this file up).

const waitForFontsReady = (page: Page) => page.evaluate(() => document.fonts.ready);

/**
 * Select's and DropdownShell's open panels are `position: absolute` —
 * CSS layout boxes never grow to contain absolutely-positioned overflow,
 * so their section's own bounding box does NOT include the open panel
 * (confirmed empirically: a plain `locator.screenshot()` on the section
 * cropped the panel out entirely). This unions the section's box with the
 * panel's box and clips a page screenshot to that instead, so the open
 * state is fully visible.
 */
async function screenshotUnion(page: Page, locators: Locator[], name: string) {
  const boxes = await Promise.all(locators.map((locator) => locator.boundingBox()));
  const resolved = boxes.filter((box): box is NonNullable<typeof box> => box !== null);
  if (resolved.length !== locators.length) {
    throw new Error('screenshotUnion: a locator had no bounding box (not visible/attached)');
  }
  const PAD = 4;
  const left = Math.max(0, Math.min(...resolved.map((b) => b.x)) - PAD);
  const top = Math.max(0, Math.min(...resolved.map((b) => b.y)) - PAD);
  const right = Math.max(...resolved.map((b) => b.x + b.width)) + PAD;
  const bottom = Math.max(...resolved.map((b) => b.y + b.height)) + PAD;
  const buffer = await page.screenshot({
    clip: { x: left, y: top, width: right - left, height: bottom - top },
  });
  expect(buffer).toMatchSnapshot(name, { maxDiffPixels: 0 });
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await waitForFontsReady(page);
});

test('full page — default at-rest state', async ({ page }) => {
  // Modal/Drawer/Popover are closed here by construction (see Showcase.tsx's
  // top comment) — this shot is the static grid, not "everything open at
  // once", which would have the three body-portaled overlays paint on top
  // of each other.
  await expect(page).toHaveScreenshot('full-page.png', { fullPage: true });
});

test('Button — variants × sizes, disabled', async ({ page }) => {
  await expect(page.getByTestId('section-button')).toHaveScreenshot('button.png');
});

test('SectionHeader — title + description', async ({ page }) => {
  await expect(page.getByTestId('section-sectionheader')).toHaveScreenshot('section-header.png');
});

test('FieldRow — label, generic child, hint', async ({ page }) => {
  await expect(page.getByTestId('section-fieldrow')).toHaveScreenshot('field-row.png');
});

test('SegmentedControl — radio + tab ariaPattern, one selected', async ({ page }) => {
  await expect(page.getByTestId('section-segmented')).toHaveScreenshot('segmented-control.png');
});

test('TextField — single + multiline (value), one focused', async ({ page }) => {
  // Text-editable controls go `:focus-visible` on click OR programmatic
  // focus in Chromium (unlike buttons, which need real keyboard nav) — so
  // this is a reproducible, deterministic capture, not a flaky one.
  await page.locator('#showcase-textfield-focus-demo').click();
  await expect(page.getByTestId('section-textfield')).toHaveScreenshot('text-field.png');
});

test('Select — closed then open', async ({ page }) => {
  const section = page.getByTestId('section-select');
  await expect(section).toHaveScreenshot('select-closed.png');

  await page.locator('#showcase-select-demo').click();
  const menu = page.locator('#showcase-select-demo-listbox');
  await expect(menu).toBeVisible();
  await screenshotUnion(page, [section, menu], 'select-open.png');

  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
});

test('DropdownShell — open, with items', async ({ page }) => {
  const section = page.getByTestId('section-dropdown');
  await page.getByTestId('showcase-dropdown-trigger').click();
  const panel = section.locator('.ui-dropdown__panel');
  await expect(panel).toBeVisible();
  await screenshotUnion(page, [section, panel], 'dropdown-shell.png');

  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
});

test('Modal — open, with title/labelledBy', async ({ page }) => {
  await page.getByTestId('showcase-modal-trigger').click();
  await expect(page.locator('.showcase-target-modal')).toBeVisible();
  // Viewport screenshot (not the section locator) — Modal portals to
  // document.body as a viewport-fixed backdrop, so the section's own
  // in-flow bounding box never contains it. See Showcase.tsx's top comment.
  await expect(page).toHaveScreenshot('modal-open.png');

  await page.keyboard.press('Escape');
  await expect(page.locator('.showcase-target-modal')).toBeHidden();
});

test('Drawer — open', async ({ page }) => {
  await page.getByTestId('showcase-drawer-trigger').click();
  await expect(page.locator('.showcase-target-drawer')).toBeVisible();
  await expect(page).toHaveScreenshot('drawer-open.png');

  await page.keyboard.press('Escape');
  await expect(page.locator('.showcase-target-drawer')).toBeHidden();
});

test('Popover — open at fixed x/y', async ({ page }) => {
  await page.getByTestId('showcase-popover-trigger').click();
  await expect(page.locator('.showcase-popover-panel')).toBeVisible();
  await expect(page).toHaveScreenshot('popover-open.png');

  await page.keyboard.press('Escape');
  await expect(page.locator('.showcase-popover-panel')).toBeHidden();
});
