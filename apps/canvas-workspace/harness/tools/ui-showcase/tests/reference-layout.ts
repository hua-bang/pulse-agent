import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const renderer = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../src/renderer/src');
const css = [
  'modules/dock/internal/ReferenceDrawer/ReferencePreviews/index.css',
  'modules/canvas/components/canvas/CanvasNodeView/index.css',
  'modules/canvas/components/canvas/CanvasNodeView/ReferenceCanvasNode/index.css',
  'modules/canvas/components/canvas/CanvasNodeView/NodeResizeHandles/index.css',
].map(file => readFileSync(resolve(renderer, file), 'utf8')).join('\n');

test('reference previews align resize bounds and artifact covers retained pages', async ({ page }) => {
  const source = readFileSync(resolve(renderer, 'modules/dock/internal/ReferenceDrawer/ReferencePreviews/index.tsx'), 'utf8');
  const artifactClass = source.match(/<div className="(reference-url-card reference-url-card--preview[^"]*)" style=\{ACTIVE_SLOT_STYLE\}>/)![1];
  await page.setContent(`<style>:root{--surface:white;--accent-border:blue;--canvas-scale:.5}${css}</style>
    <div class="reference-preview-area" style="position:absolute;width:450px;height:780px">
      <div id="old" class="reference-native-card reference-native-card--persistent" style="z-index:1">Old page</div>
      <div id="artifact" class="${artifactClass}" style="z-index:2"><div class="reference-url-preview">Artifact</div></div>
    </div>
    <div style="position:absolute;left:520px;top:40px;transform:scale(.5);transform-origin:top left">
      <div id="ref" class="canvas-node canvas-node--reference canvas-node--selected" style="width:600px;height:400px">
        <div class="node-body node-body--reference"><div id="source" class="canvas-node canvas-node--image" style="width:582px;height:330px;transform:translate(0,0)">Preview</div></div>
        <div class="resize-handle resize-handle--right"></div>
      </div>
    </div>`);
  const artifact = await page.locator('#artifact').boundingBox();
  expect(artifact!.height).toBe(764);
  expect(await page.evaluate(() => document.elementFromPoint(100, 400)?.closest('#artifact')?.id)).toBe('artifact');
  expect(await page.locator('#source').boundingBox()).toEqual(await page.locator('#ref').boundingBox());
  expect((await page.locator('.resize-handle--right').boundingBox())!.width).toBe(10);
});
