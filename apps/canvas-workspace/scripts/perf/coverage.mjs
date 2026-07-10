const isMeasuredValue = (value) => (
  typeof value === 'boolean'
  || (typeof value === 'number' && Number.isFinite(value))
);

const summarizeClass = (definitions, measuredIds) => {
  const measured = definitions.filter((definition) => measuredIds.has(definition.id)).length;
  const total = definitions.length;
  return {
    measured,
    total,
    status: total === 0 ? 'not-configured' : measured === total ? 'complete' : measured === 0 ? 'unavailable' : 'partial',
  };
};

/**
 * Coverage counts known metric ids with a real scalar value. Unknown ids,
 * duplicates, nulls, and NaN must not make a report look more complete.
 * Diagnostic metrics are intentionally separate from the core CI contract.
 */
export const summarizeCoverage = (dictionary, snapshot) => {
  const definitions = dictionary?.metrics ?? [];
  const knownIds = new Set(definitions.map((definition) => definition.id));
  const measuredIds = new Set((snapshot?.metrics ?? [])
    .filter((metric) => knownIds.has(metric.id) && isMeasuredValue(metric.value))
    .map((metric) => metric.id));
  const core = definitions.filter((definition) => definition.coverageClass !== 'diagnostic');
  const diagnostic = definitions.filter((definition) => definition.coverageClass === 'diagnostic');
  const coreCoverage = summarizeClass(core, measuredIds);
  return {
    measured: coreCoverage.measured,
    total: coreCoverage.total,
    diagnostic: summarizeClass(diagnostic, measuredIds),
  };
};
