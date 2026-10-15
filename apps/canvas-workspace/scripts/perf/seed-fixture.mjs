export const PERF_SEED_NOTE_ID = 'perf-seed-note';

export const PERF_SEED_TRANSFORM = { x: 0, y: 0, scale: 0.8 };

export const buildPerfImageFixture = ({ filePaths, viewport, now }) => {
  const padding = 24;
  if (!filePaths.length || !Number.isFinite(viewport?.width) || !Number.isFinite(viewport?.height)
    || viewport.width <= padding * 2 || viewport.height <= padding * 2) {
    throw new Error('image-memory fixture requires images and a visible canvas viewport');
  }
  // Prefer the existing 0.5 gesture zoom and wrap into more rows when Dock
  // narrows the canvas. Zooming a fixed five-column grid out also shrinks
  // the resize scenario's 16px handles below its 8px hit-target threshold.
  let layout = null;
  for (let columns = Math.min(5, filePaths.length); columns >= 1; columns--) {
    const width = (columns - 1) * 220 + 200;
    const height = (Math.ceil(filePaths.length / columns) - 1) * 180 + 150;
    const scale = Math.min(0.5, (viewport.width - padding * 2) / width, (viewport.height - padding * 2) / height);
    if (!layout || scale > layout.scale) layout = { columns, width, height, scale };
  }
  const nodes = filePaths.map((filePath, index) => ({
    id: `perf-image-${index}`,
    type: 'image',
    title: `perf 4K image ${index}`,
    x: 80 + (index % layout.columns) * 220,
    y: 540 + Math.floor(index / layout.columns) * 180,
    width: 200,
    height: 150,
    updatedAt: now,
    data: { filePath },
  }));
  const { width, height, scale } = layout;
  const centeredY = (viewport.height - height * scale) / 2 - 540 * scale;
  // Later gesture scenarios (typing, drag) press the seeded note's header at
  // y 80, above the image grid. Centering the grid alone can push that header
  // under the chrome above the canvas, so keep it on screen when the note and
  // the grid fit together. This function runs stringified in the page, so
  // the note's y stays a literal that matches buildPerfSeedNodes.
  const noteVisibleY = padding - 80 * scale;
  const fitsWithNote = noteVisibleY + (540 + height) * scale <= viewport.height - padding;
  return {
    nodes,
    transform: {
      x: (viewport.width - width * scale) / 2 - 80 * scale,
      y: fitsWithNote ? Math.max(centeredY, noteVisibleY) : centeredY,
      scale,
    },
  };
};

export const buildPerfSeedNodes = ({
  existingNodes,
  count,
  webpageCount,
  webpageHtml,
  noteFilePath,
  noteFileName,
  noteId,
  now,
}) => {
  const nodes = [...existingNodes];
  const existingIds = new Set(nodes.map((node) => node.id));
  if (!existingIds.has(noteId)) {
    nodes.unshift({
      id: noteId,
      type: 'file',
      title: noteFileName.replace(/\.md$/, '') || 'perf benchmark',
      x: 80,
      y: 80,
      width: 400,
      height: 300,
      updatedAt: now,
      data: {
        filePath: noteFilePath,
        content: 'Pulse Canvas deterministic performance fixture.\n',
        saved: true,
        modified: false,
      },
    });
    existingIds.add(noteId);
  }

  const webpageStride = webpageCount > 0 ? Math.max(1, Math.floor(count / webpageCount)) : 0;
  const strideX = webpageCount > 0 ? 560 : 240;
  const strideY = webpageCount > 0 ? 420 : 160;
  for (let index = 0; nodes.length < count; index++) {
    const id = `perf-seed-${index}`;
    if (existingIds.has(id)) continue;
    const x = 560 + (index % 10) * strideX;
    const y = 80 + Math.floor(index / 10) * strideY;
    if (webpageStride > 0 && index % webpageStride === 0) {
      nodes.push({
        id,
        type: 'iframe',
        title: `perf web ${index}`,
        x,
        y,
        width: 520,
        height: 400,
        updatedAt: now,
        data: { url: '', mode: 'html', html: webpageHtml, prompt: '' },
      });
    } else {
      nodes.push({
        id,
        type: 'text',
        title: `perf ${index}`,
        x,
        y,
        width: 200,
        height: 120,
        updatedAt: now,
        data: { text: `perf seed node ${index}` },
      });
    }
    existingIds.add(id);
  }
  return nodes;
};
