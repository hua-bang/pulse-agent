import { lazy, Suspense, type ComponentProps } from 'react';

/**
 * Lazy boundary for the experimental graph view. GraphPage pulls
 * react-force-graph-2d + d3-force (~400 KB); it is flag- and route-gated and
 * never on the startup path, so loading it on demand keeps that code out of
 * the entry chunk (finding C9). The repo's first React.lazy boundary — extend
 * this pattern to the node bodies (xterm / tiptap) next.
 */
const GraphPage = lazy(() =>
  import('./GraphPage').then((m) => ({ default: m.GraphPage })),
);

export const GraphPageLazy = (props: ComponentProps<typeof GraphPage>) => (
  <Suspense fallback={null}>
    <GraphPage {...props} />
  </Suspense>
);
