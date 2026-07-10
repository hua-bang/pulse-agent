const configuredCounterGates = (runtime) => Object.entries(runtime).flatMap(
  ([scenario, config]) => Object.keys(config.counters ?? {}).map((counter) => ({ scenario, counter })),
);

const dictionaryCounterGates = (dictionary) => (dictionary?.metrics ?? []).flatMap((metric) => {
  if (metric.level !== 'gate') return [];
  const match = metric.id.match(/^interact\.([^.]+)\.counter\.(.+)$/);
  if (!match) return [];
  return [{ scenario: match[1], counter: match[2].replaceAll('_', '-') }];
});

export const compareCounterGates = (baselines, scenarios, selectedScenarios, dictionary) => {
  const runtime = baselines.runtime ?? {};
  const selected = new Set(selectedScenarios ?? Object.keys(runtime));
  const results = [];
  const gates = new Map();

  for (const gate of [
    ...dictionaryCounterGates(dictionary),
    ...configuredCounterGates(runtime),
  ]) {
    gates.set(`${gate.scenario}:${gate.counter}`, gate);
  }

  for (const { scenario, counter } of gates.values()) {
    if (!selected.has(scenario)) continue;
    const report = scenarios[scenario]?.report;
    const value = report?.counters?.[counter];
    const max = runtime[scenario]?.counters?.[counter]?.max;
    if (typeof max !== 'number') {
      results.push({
        scenario,
        counter,
        max: null,
        value: typeof value === 'number' ? value : null,
        pass: false,
        missingConfig: true,
      });
      continue;
    }
    if (typeof value !== 'number') {
      results.push({ scenario, counter, max, value: null, pass: false, missing: true });
      continue;
    }
    results.push({ scenario, counter, max, value, pass: value <= max });
  }

  return results;
};
