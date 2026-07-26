import { describe, expect, it } from 'vitest';
import {
  EXPERIMENTAL_FEATURES,
  EXPERIMENTAL_FLAG_AGENT_DEBUG_TRACE,
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

const grandfatheredFeatureIds = [
  EXPERIMENTAL_FLAG_AGENT_DEBUG_TRACE,
  EXPERIMENTAL_FLAG_AGENT_TEAMS,
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

  it('shows grandfathered features only to users who currently have them enabled', () => {
    const hiddenIds = getVisibleExperimentalFeatures({}).map((feature) => feature.id);
    const enabledOverrides = Object.fromEntries(
      grandfatheredFeatureIds.map((id) => [id, true]),
    );
    const visibleIds = getVisibleExperimentalFeatures(enabledOverrides)
      .map((feature) => feature.id);
    const values = resolveFeatureValues(enabledOverrides);

    for (const id of grandfatheredFeatureIds) {
      expect(hiddenIds).not.toContain(id);
      expect(visibleIds).toContain(id);
      expect(values[id]).toBe(true);
    }
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
