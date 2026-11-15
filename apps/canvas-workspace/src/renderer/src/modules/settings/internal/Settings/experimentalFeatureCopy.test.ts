import { describe, expect, it } from 'vitest';
import { EXPERIMENTAL_FEATURES } from '../../../../../../shared/experimental-features';
import { FEATURE_COPY } from './experimentalFeatureCopy';

describe('experimental feature copy', () => {
  it('translates every registered feature', () => {
    for (const feature of EXPERIMENTAL_FEATURES) {
      const copy = FEATURE_COPY[feature.id];
      expect(copy, feature.id).toBeDefined();
      expect(copy.en.label && copy.en.description, feature.id).toBeTruthy();
      expect(copy.zh.label && copy.zh.description, feature.id).toBeTruthy();
      expect(copy.zh.description, feature.id).not.toBe(copy.en.description);
    }
  });
});
