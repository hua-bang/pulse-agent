import { describe, expect, it } from 'vitest';
import {
  EXPERIMENTAL_FEATURES,
  EXPERIMENTAL_FLAG_AGENT_RUNTIME_CONTROL,
  EXPERIMENTAL_FLAG_AGENT_TEAMS,
  EXPERIMENTAL_FLAG_WEBVIEW_PAGE_CONTROL,
  EXPERIMENTAL_FLAG_WORKSPACE_GRAPH,
  EXPERIMENTAL_FLAG_WORKSPACE_NODES,
  canConfigureExperimentalFeature,
  getVisibleExperimentalFeatures,
  resolveFeatureValues,
} from './experimental-features';

const promotedFeatureIds = [
  EXPERIMENTAL_FLAG_WORKSPACE_NODES,
  EXPERIMENTAL_FLAG_WORKSPACE_GRAPH,
  EXPERIMENTAL_FLAG_WEBVIEW_PAGE_CONTROL,
  EXPERIMENTAL_FLAG_AGENT_RUNTIME_CONTROL,
];

describe('experimental feature lifecycle', () => {
  it('keeps promoted stable features enabled and out of Experimental', () => {
    const staleDisabledOverrides = Object.fromEntries(
      promotedFeatureIds.map((id) => [id, false]),
    );

    const values = resolveFeatureValues(staleDisabledOverrides);
    const visibleIds = getVisibleExperimentalFeatures(staleDisabledOverrides)
      .map((feature) => feature.id);

    for (const id of promotedFeatureIds) {
      expect(values[id]).toBe(true);
      expect(visibleIds).not.toContain(id);
    }
  });

  it('shows Agent Teams only to users who currently have it enabled', () => {
    const hiddenIds = getVisibleExperimentalFeatures({}).map((feature) => feature.id);
    const visibleIds = getVisibleExperimentalFeatures({
      [EXPERIMENTAL_FLAG_AGENT_TEAMS]: true,
    }).map((feature) => feature.id);

    expect(hiddenIds).not.toContain(EXPERIMENTAL_FLAG_AGENT_TEAMS);
    expect(visibleIds).toContain(EXPERIMENTAL_FLAG_AGENT_TEAMS);
    expect(resolveFeatureValues({
      [EXPERIMENTAL_FLAG_AGENT_TEAMS]: true,
    })[EXPERIMENTAL_FLAG_AGENT_TEAMS]).toBe(true);
  });

  it('allows mutation only for visible experimental features', () => {
    const stable = EXPERIMENTAL_FEATURES.find(
      (feature) => feature.id === EXPERIMENTAL_FLAG_WORKSPACE_NODES,
    )!;
    const grandfathered = EXPERIMENTAL_FEATURES.find(
      (feature) => feature.id === EXPERIMENTAL_FLAG_AGENT_TEAMS,
    )!;

    expect(canConfigureExperimentalFeature(stable, {})).toBe(false);
    expect(canConfigureExperimentalFeature(grandfathered, {})).toBe(false);
    expect(canConfigureExperimentalFeature(grandfathered, {
      [EXPERIMENTAL_FLAG_AGENT_TEAMS]: true,
    })).toBe(true);
  });
});
