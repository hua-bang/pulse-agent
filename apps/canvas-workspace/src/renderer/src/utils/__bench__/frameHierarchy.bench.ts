import { bench, describe } from 'vitest';
import {
  collectContainerDescendants,
  computeContainerDepths,
  computeParentContainerMap,
  filterCollapsedFrameDescendants,
} from '../frameHierarchy';
import { makeNodes } from '../../__perf_fixtures__/nodes';

/**
 * Canvas hot-path pure functions. computeParentContainerMap is O(nodes x
 * containers) and is re-run whenever a single frame/group node re-renders
 * (finding A3); computeContainerDepths feeds render order; both run per
 * drag/resize tick. Scaling node count exposes the growth curve so an
 * O(n^2) regression shows up as a worse-than-linear slope.
 */
for (const n of [100, 500, 2000]) {
  const nodes = makeNodes(n, { seed: 7 });
  // n is embedded in each bench name so the value survives in the JSON output
  // regardless of how the reporter nests describe() groups — the dashboard
  // parses "<fn> @ n=<count>" to plot the growth curve.
  describe(`n=${n}`, () => {
    bench(`computeParentContainerMap @ n=${n}`, () => {
      computeParentContainerMap(nodes);
    });
    bench(`computeContainerDepths @ n=${n}`, () => {
      computeContainerDepths(nodes);
    });
    bench(`filterCollapsedFrameDescendants @ n=${n}`, () => {
      filterCollapsedFrameDescendants(nodes);
    });
  });
}

/**
 * collectContainerDescendants rebuilds the full parent map on every call —
 * this is the per-container-render cost in A3. Bench a single lookup so the
 * map-rebuild dominates.
 */
for (const n of [500, 2000]) {
  const nodes = makeNodes(n, { seed: 7 });
  const containerId =
    nodes.find((node) => node.type === 'frame' || node.type === 'group')?.id ?? nodes[0].id;
  describe(`collectContainerDescendants n=${n}`, () => {
    bench(`collectContainerDescendants @ n=${n}`, () => {
      collectContainerDescendants(containerId, nodes);
    });
  });
}
