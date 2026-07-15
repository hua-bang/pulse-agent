export const DEFAULT_SCENARIOS = [
  'startup',
  'chat-stream',
  'typing',
  'resize',
  'drag',
  'zoom-cold',
  'panzoom',
  'zoom-settle',
  'pty-stream',
  'renderer-trace',
  'image-memory',
  'ws-cycle',
];

export const DIAGNOSTIC_SCENARIOS = [
  'panzoom-trace',
  'webview-lifecycle',
  'webview-discard-restore',
];

const SCENARIO_SET = new Set([...DEFAULT_SCENARIOS, ...DIAGNOSTIC_SCENARIOS]);
const VALUE_FLAGS = new Set([
  '--seed-nodes',
  '--seed-webpages',
  '--seed-url-webviews',
  '--repeat',
]);

const readStrictArgs = (args, { allowScenario, booleanFlags }) => {
  const values = new Map();
  const booleans = new Set();
  const allowedBooleans = new Set(booleanFlags);

  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (allowedBooleans.has(flag)) {
      if (booleans.has(flag)) throw new Error(`${flag} was specified more than once`);
      booleans.add(flag);
      continue;
    }

    const isValueFlag = VALUE_FLAGS.has(flag) || (allowScenario && flag === '--scenario');
    if (!isValueFlag) throw new Error(`unknown option: ${flag}`);
    if (values.has(flag)) throw new Error(`${flag} was specified more than once`);
    const value = args[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`${flag} requires a value`);
    }
    values.set(flag, value);
    index += 1;
  }

  return { values, booleans };
};

const nonNegativeInteger = (values, flag, fallback) => {
  const raw = values.get(flag) ?? String(fallback);
  if (!/^(?:0|[1-9]\d*)$/.test(raw)) {
    throw new Error(`${flag} must be a non-negative integer`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${flag} must be a safe non-negative integer`);
  }
  return value;
};

const positiveInteger = (values, flag, fallback) => {
  const raw = values.get(flag) ?? String(fallback);
  if (!/^[1-9]\d*$/.test(raw)) throw new Error(`${flag} must be a positive integer`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) throw new Error(`${flag} must be a safe positive integer`);
  return value;
};

const parseFixtureCounts = (values, defaults) => {
  const seedNodes = nonNegativeInteger(values, '--seed-nodes', defaults.seedNodes);
  const seedWebpages = nonNegativeInteger(values, '--seed-webpages', defaults.seedWebpages);
  const seedUrlWebviews = nonNegativeInteger(
    values,
    '--seed-url-webviews',
    defaults.seedUrlWebviews,
  );
  const repeat = positiveInteger(values, '--repeat', defaults.repeat);

  if (seedWebpages > seedNodes) {
    throw new Error('--seed-webpages cannot exceed --seed-nodes');
  }
  if (seedUrlWebviews > seedWebpages) {
    throw new Error('--seed-url-webviews cannot exceed --seed-webpages');
  }

  return { seedNodes, seedWebpages, seedUrlWebviews, repeat };
};

export const parseScenarioCliArgs = (args) => {
  const { values } = readStrictArgs(args, { allowScenario: true, booleanFlags: [] });
  const counts = parseFixtureCounts(values, {
    seedNodes: 0,
    seedWebpages: 0,
    seedUrlWebviews: 0,
    repeat: 1,
  });
  const scenarios = (values.get('--scenario') ?? DEFAULT_SCENARIOS.join(','))
    .split(',')
    .map((name) => name.trim());
  if (scenarios.some((name) => !name)) throw new Error('--scenario must not contain empty names');
  for (const scenario of scenarios) {
    if (!SCENARIO_SET.has(scenario)) throw new Error(`unknown scenario: ${scenario}`);
  }
  if (new Set(scenarios).size !== scenarios.length) {
    throw new Error('--scenario must not contain duplicate names');
  }

  return { ...counts, scenarios };
};

export const parseReportCliArgs = (args) => {
  const { values, booleans } = readStrictArgs(args, {
    allowScenario: false,
    booleanFlags: ['--bundle-only', '--no-build'],
  });
  return {
    bundleOnly: booleans.has('--bundle-only'),
    noBuild: booleans.has('--no-build'),
    ...parseFixtureCounts(values, {
      seedNodes: 100,
      seedWebpages: 0,
      seedUrlWebviews: 0,
      repeat: 3,
    }),
  };
};

export const buildScenarioRunnerArgs = ({
  seedNodes,
  seedWebpages,
  seedUrlWebviews,
  repeat,
}) => [
  '--seed-nodes', String(seedNodes),
  '--seed-webpages', String(seedWebpages),
  '--seed-url-webviews', String(seedUrlWebviews),
  '--repeat', String(repeat),
];
