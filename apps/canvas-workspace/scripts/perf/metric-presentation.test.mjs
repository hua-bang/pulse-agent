import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  displayPriorityOf,
  organizeAspectMetrics,
  validateMetricPresentation,
} from './metric-presentation.mjs';

describe('metric presentation metadata', () => {
  it('keeps the real metric dictionary complete and internally consistent', () => {
    const dictionary = JSON.parse(readFileSync(new URL('../../perf/metrics.json', import.meta.url), 'utf8'));

    expect(validateMetricPresentation(dictionary)).toEqual([]);

    for (const aspect of dictionary.aspects) {
      const definitions = dictionary.metrics.filter((definition) => definition.aspect === aspect.id);
      const organized = organizeAspectMetrics(aspect, definitions);
      const renderedIds = [
        ...organized.primary,
        ...organized.supporting.flatMap((group) => group.definitions),
        ...organized.diagnostic.flatMap((group) => group.definitions),
      ].map((definition) => definition.id);

      expect(renderedIds).toHaveLength(definitions.length);
      expect(new Set(renderedIds).size).toBe(definitions.length);
    }
  });

  it('falls back without parsing metric ids when older fixtures lack presentation metadata', () => {
    const aspect = {
      id: 'startup',
      northStar: 'startup.primary',
      dimensions: [{ id: 'known', name: 'Known' }],
    };
    const definitions = [
      { id: 'startup.primary', dimension: 'known' },
      { id: 'startup.supporting', dimension: 'known' },
      { id: 'startup.trace', dimension: 'unknown', coverageClass: 'diagnostic' },
    ];

    expect(definitions.map((definition) => displayPriorityOf(aspect, definition)))
      .toEqual(['primary', 'supporting', 'diagnostic']);

    const organized = organizeAspectMetrics(aspect, definitions);
    expect(organized.primary.map((definition) => definition.id)).toEqual(['startup.primary']);
    expect(organized.supporting[0].definitions.map((definition) => definition.id))
      .toEqual(['startup.supporting']);
    expect(organized.diagnostic[0]).toMatchObject({
      id: 'other',
      name: '其他指标',
    });
  });

  it('reports invalid dimensions, priorities, north stars, and duplicate ids', () => {
    const errors = validateMetricPresentation({
      aspects: [{
        id: 'startup',
        northStar: 'startup.missing',
        dimensions: [{ id: 'phase', name: 'Phase' }, { id: 'phase', name: 'Duplicate' }],
      }],
      metrics: [
        {
          id: 'startup.metric',
          aspect: 'startup',
          dimension: 'unknown',
          displayPriority: 'urgent',
        },
        {
          id: 'startup.metric',
          aspect: 'missing',
          dimension: 'phase',
          displayPriority: 'primary',
        },
      ],
    });

    expect(errors).toEqual(expect.arrayContaining([
      'duplicate dimension id in startup: phase',
      'invalid displayPriority for startup.metric: urgent',
      'unknown dimension for startup.metric: unknown',
      'duplicate metric id: startup.metric',
      'unknown aspect for startup.metric: missing',
      'missing northStar for startup: startup.missing',
      'startup must have 1-4 primary metrics, found 0',
    ]));
  });
});
