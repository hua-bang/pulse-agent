export const PERF_SEED_NOTE_ID = 'perf-seed-note';

export const PERF_SEED_TRANSFORM = { x: 0, y: 0, scale: 0.8 };

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
