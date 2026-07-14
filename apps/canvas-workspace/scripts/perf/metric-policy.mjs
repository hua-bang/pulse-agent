const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);
const isPlainObject = (value) => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
);

const matchesProfile = (appliesTo, env) => Object.entries(appliesTo ?? {})
  .every(([key, value]) => env?.[key] === value);

const HISTORY_PROFILE_KEYS = [
  'os', 'arch', 'seedNodes', 'seedWebpages', 'seedUrlWebviews',
  'repeat', 'fixtureVersion', 'sessionProfile', 'headless',
];

const historyProfileValue = (env, key) => (
  key === 'seedUrlWebviews' ? env?.[key] ?? 0 : env?.[key]
);

export const isCompatibleHistorySnapshot = (current, candidate) => (
  current?.machineId === candidate?.machineId
  && HISTORY_PROFILE_KEYS.every((key) => (
    historyProfileValue(current?.env, key) === historyProfileValue(candidate?.env, key)
  ))
);

const classifyTarget = (direction, value, target, warning) => {
  if (direction === 'lower') {
    if (value <= target) return 'met';
    return value <= warning ? 'near-warning' : 'missed';
  }
  if (direction === 'higher') {
    if (value >= target) return 'met';
    return value >= warning ? 'near-warning' : 'missed';
  }
  if (direction === 'exact' || direction === 'true') {
    return value === target ? 'met' : 'missed';
  }
  return 'pending';
};

const targetHeadroom = (direction, value, target) => {
  if (direction === 'lower') return target - value;
  if (direction === 'higher') return value - target;
  return null;
};

export const evaluatePolicyGate = (gate, value) => {
  if (!gate) return null;
  let limit;
  let pass;
  if (gate.kind === 'ratchet') {
    limit = Math.round(gate.baseline * (1 + gate.tolerancePct / 100));
    pass = typeof value === 'number' && Number.isFinite(value) && value <= limit;
  } else if (gate.kind === 'max') {
    limit = gate.value;
    pass = typeof value === 'number' && Number.isFinite(value) && value <= limit;
  } else if (gate.kind === 'min') {
    limit = gate.value;
    pass = typeof value === 'number' && Number.isFinite(value) && value >= limit;
  } else if (gate.kind === 'exact') {
    limit = gate.value;
    pass = value === limit;
  } else if (gate.kind === 'true') {
    limit = true;
    pass = value === true;
  } else {
    return null;
  }
  return { pass, limit, operator: gate.kind };
};

const validateThreshold = (id, label, direction, value, errors) => {
  if (direction === 'true') {
    if (value !== true) errors.push(`${id}: ${label} must be true`);
    return;
  }
  if (!isFiniteNumber(value)) errors.push(`${id}: ${label} must be a finite number`);
};

const validateGate = (id, gate, errors) => {
  if (!gate || typeof gate !== 'object' || Array.isArray(gate)) {
    errors.push(`${id}: gate must be an object`);
    return;
  }
  if (!['bundle', 'runtime'].includes(gate.scope)) {
    errors.push(`${id}: gate scope must be bundle or runtime`);
  }
  if (gate.kind === 'max' || gate.kind === 'min' || gate.kind === 'exact') {
    if (!isFiniteNumber(gate.value)) errors.push(`${id}: ${gate.kind} gate value must be finite`);
    return;
  }
  if (gate.kind === 'true') return;
  if (gate.kind === 'ratchet') {
    if (!isFiniteNumber(gate.baseline) || gate.baseline < 0) {
      errors.push(`${id}: ratchet baseline must be a non-negative finite number`);
    }
    if (!isFiniteNumber(gate.tolerancePct) || gate.tolerancePct < 0) {
      errors.push(`${id}: ratchet tolerancePct must be a non-negative finite number`);
    }
    return;
  }
  errors.push(`${id}: unsupported gate kind ${String(gate.kind)}`);
};

export const validatePerformancePolicies = (dictionary, baselines) => {
  const errors = [];
  const definitions = dictionary?.metrics ?? [];
  const definitionById = new Map();
  for (const definition of definitions) {
    if (definitionById.has(definition.id)) errors.push(`${definition.id}: duplicate metric definition`);
    definitionById.set(definition.id, definition);
  }
  if (!Number.isInteger(baselines?.policyVersion) || baselines.policyVersion < 1) {
    errors.push('policyVersion must be a positive integer');
  }

  const policies = baselines?.policies;
  if (!policies || typeof policies !== 'object' || Array.isArray(policies)) {
    return [...errors, 'policies must be an object'];
  }
  const profiles = isPlainObject(baselines?.profiles) ? baselines.profiles : {};
  if (!isPlainObject(baselines?.profiles)) errors.push('profiles must be an object');

  for (const [id, policy] of Object.entries(policies)) {
    const definition = definitionById.get(id);
    if (!definition) {
      errors.push(`${id}: unknown metric`);
      continue;
    }
    if (!['lower', 'higher', 'exact', 'true'].includes(definition.direction)) {
      errors.push(`${id}: invalid direction ${String(definition.direction)}`);
    }
    if (!definition.measurementProfile || policy.profile !== definition.measurementProfile) {
      errors.push(`${id}: profile must match metrics.json measurementProfile`);
    }
    const profile = profiles[policy.profile];
    if (!isPlainObject(profile)) {
      errors.push(`${id}: profile ${String(policy.profile)} is not defined as an object`);
    } else if (!isPlainObject(profile.appliesTo)) {
      errors.push(`${id}: profile ${String(policy.profile)} appliesTo must be an object`);
    } else if (policy.profile === 'global-deterministic' && Object.keys(profile.appliesTo).length > 0) {
      errors.push(`${id}: global-deterministic appliesTo must be empty`);
    } else if (policy.profile !== 'global-deterministic' && Object.keys(profile.appliesTo).length === 0) {
      errors.push(`${id}: local profile ${String(policy.profile)} appliesTo cannot be empty`);
    }
    if (!['low', 'medium', 'high'].includes(policy.confidence)) {
      errors.push(`${id}: confidence must be low, medium, or high`);
    }
    if (typeof policy.basis !== 'string' || !policy.basis.trim()) errors.push(`${id}: basis is required`);
    if (typeof policy.asOf !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(policy.asOf)) {
      errors.push(`${id}: asOf must use YYYY-MM-DD`);
    }
    if (!hasOwn(policy, 'target')) {
      errors.push(`${id}: target is required`);
    } else {
      validateThreshold(id, 'target', definition.direction, policy.target, errors);
    }
    if (definition.direction === 'exact' || definition.direction === 'true') {
      if (hasOwn(policy, 'warning')) errors.push(`${id}: ${definition.direction} policies cannot define warning`);
    } else if (!hasOwn(policy, 'warning')) {
      errors.push(`${id}: warning is required`);
    } else {
      validateThreshold(id, 'warning', definition.direction, policy.warning, errors);
      if (
        definition.direction === 'lower'
        && isFiniteNumber(policy.target)
        && isFiniteNumber(policy.warning)
        && policy.target > policy.warning
      ) errors.push(`${id}: lower target must be <= warning`);
      if (
        definition.direction === 'higher'
        && isFiniteNumber(policy.target)
        && isFiniteNumber(policy.warning)
        && policy.target < policy.warning
      ) errors.push(`${id}: higher target must be >= warning`);
    }
    if (policy.gate) {
      validateGate(id, policy.gate, errors);
      if (definition.level !== 'gate') {
        errors.push(`${id}: policy gate requires level gate in metrics.json`);
      }
      const compatibleKinds = {
        lower: ['max', 'ratchet', 'exact'],
        higher: ['min', 'exact'],
        exact: ['exact'],
        true: ['true'],
      }[definition.direction] ?? [];
      if (!compatibleKinds.includes(policy.gate.kind)) {
        errors.push(`${id}: ${policy.gate.kind} gate is incompatible with ${definition.direction} direction`);
      }
    }
  }

  for (const definition of definitions.filter((entry) => entry.level === 'gate')) {
    if (!policies[definition.id]?.gate) {
      errors.push(`${definition.id}: level gate requires an executable policy gate`);
    }
  }
  return errors;
};

const emptyTargetSummary = () => ({
  configured: 0,
  applicable: 0,
  measured: 0,
  met: 0,
  nearWarning: 0,
  missed: 0,
  pending: 0,
  notApplicable: 0,
});

export const applyMetricPolicies = (dictionary, baselines, snapshot, options = {}) => {
  const errors = validatePerformancePolicies(dictionary, baselines);
  if (errors.length > 0) {
    throw new Error(`Invalid performance policy:\n- ${errors.join('\n- ')}`);
  }

  const originalEntries = snapshot?.metrics ?? [];
  const entryById = new Map();
  for (const entry of originalEntries) {
    if (entryById.has(entry.id)) throw new Error(`Duplicate performance metric: ${entry.id}`);
    entryById.set(entry.id, entry);
  }

  const allowedScopes = options.gateScopes ? new Set(options.gateScopes) : null;
  const policiesById = {};
  const targetSummary = emptyTargetSummary();
  const gateSummary = { passed: 0, failed: 0, total: 0 };

  for (const definition of dictionary.metrics) {
    const entry = entryById.get(definition.id);
    const policy = baselines.policies[definition.id];
    const resolved = resolveMetricPolicy({
      definition,
      entry,
      baselines,
      env: { ...snapshot?.env, machineId: snapshot?.machineId },
    });
    const gate = policy?.gate;
    const scopeSelected = !allowedScopes || !gate?.scope || allowedScopes.has(gate.scope);
    let gateEvaluation = null;
    let gateStatus = gate ? 'not-required' : 'not-configured';
    if (gate && resolved.applicable && scopeSelected) {
      gateEvaluation = evaluatePolicyGate(gate, entry?.value);
      gateStatus = entry ? (gateEvaluation?.pass ? 'pass' : 'fail') : 'unavailable';
      gateSummary.total += 1;
      if (gateEvaluation?.pass) gateSummary.passed += 1;
      else gateSummary.failed += 1;
    } else if (gate && !resolved.applicable) {
      gateStatus = 'not-applicable';
    }

    const evaluation = {
      ...resolved,
      gateStatus,
      ...(gateEvaluation ? {
        gateLimit: gateEvaluation.limit,
        gateOperator: gateEvaluation.operator,
        gatePass: gateEvaluation.pass,
      } : {}),
    };
    policiesById[definition.id] = evaluation;

    if (policy) {
      targetSummary.configured += 1;
      if (!resolved.applicable) targetSummary.notApplicable += 1;
      else {
        targetSummary.applicable += 1;
        if (resolved.status === 'met') targetSummary.met += 1;
        else if (resolved.status === 'near-warning') targetSummary.nearWarning += 1;
        else if (resolved.status === 'missed') targetSummary.missed += 1;
        else targetSummary.pending += 1;
        if (resolved.status !== 'pending') targetSummary.measured += 1;
      }
    }
  }

  return {
    snapshot: {
      ...snapshot,
      metrics: originalEntries.map((entry) => {
        const policy = policiesById[entry.id];
        if (!policy) return { ...entry };
        const hasPolicyGate = Boolean(baselines.policies[entry.id]?.gate);
        const metricEntry = hasPolicyGate
          ? Object.fromEntries(
              Object.entries(entry).filter(([key]) => !['pass', 'limit', 'gateOperator'].includes(key)),
            )
          : entry;
        return {
          ...metricEntry,
          policy,
          ...(policy.gatePass !== undefined ? {
            pass: policy.gatePass,
            limit: policy.gateLimit,
            gateOperator: policy.gateOperator,
          } : {}),
        };
      }),
    },
    policiesById,
    targetSummary,
    gateSummary,
  };
};

export const buildP0TargetDetails = (dictionary, snapshot, policiesById = {}) => {
  const entryById = new Map((snapshot?.metrics ?? []).map((entry) => [entry.id, entry]));
  return (dictionary?.metrics ?? [])
    .filter((definition) => definition.displayPriority === 'primary')
    .map((definition) => {
      const entry = entryById.get(definition.id);
      const policy = entry?.policy ?? policiesById[definition.id] ?? {};
      return {
        id: definition.id,
        aspect: definition.aspect,
        label: definition.label,
        unit: definition.unit,
        value: entry?.value ?? null,
        target: policy.target ?? null,
        warning: policy.warning ?? null,
        status: policy.status ?? 'pending',
        headroom: policy.headroom ?? null,
        confidence: policy.confidence ?? null,
        applicable: policy.applicable ?? true,
      };
    });
};

export const resolveMetricPolicy = ({ definition, entry, baselines, env }) => {
  const policy = baselines?.policies?.[definition.id];
  if (!policy) {
    return { applicable: true, status: 'pending', target: null, warning: null, headroom: null };
  }

  const profile = baselines?.profiles?.[policy.profile];
  const applicable = Boolean(profile) && matchesProfile(profile.appliesTo, env);
  const resolved = {
    ...policy,
    applicable,
    status: applicable ? 'pending' : 'not-applicable',
    headroom: null,
  };
  if (!applicable || !entry || !hasOwn(entry, 'value') || entry.value === null) return resolved;

  return {
    ...resolved,
    status: classifyTarget(definition.direction, entry.value, policy.target, policy.warning),
    headroom: targetHeadroom(definition.direction, entry.value, policy.target),
  };
};
