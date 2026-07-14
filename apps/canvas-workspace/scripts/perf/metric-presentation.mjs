const DISPLAY_PRIORITIES = new Set(['primary', 'supporting', 'diagnostic']);

export const displayPriorityOf = (aspect, definition) => {
  if (DISPLAY_PRIORITIES.has(definition.displayPriority)) return definition.displayPriority;
  if (definition.id === aspect.northStar) return 'primary';
  if (definition.coverageClass === 'diagnostic') return 'diagnostic';
  return 'supporting';
};

const groupByDimension = (aspect, definitions) => {
  const declared = aspect.dimensions ?? [];
  const definitionsByDimension = new Map();

  for (const definition of definitions) {
    const dimensionId = definition.dimension ?? 'other';
    const group = definitionsByDimension.get(dimensionId) ?? [];
    group.push(definition);
    definitionsByDimension.set(dimensionId, group);
  }

  const groups = declared
    .filter((dimension) => definitionsByDimension.has(dimension.id))
    .map((dimension) => ({
      ...dimension,
      definitions: definitionsByDimension.get(dimension.id),
    }));

  const declaredIds = new Set(declared.map((dimension) => dimension.id));
  const undeclared = [...definitionsByDimension.entries()]
    .filter(([dimensionId]) => !declaredIds.has(dimensionId))
    .flatMap(([, items]) => items);

  if (undeclared.length > 0) {
    groups.push({
      id: 'other',
      name: '其他指标',
      description: '尚未归入专题维度',
      definitions: undeclared,
    });
  }

  return groups;
};

export const organizeAspectMetrics = (aspect, definitions) => {
  const byPriority = {
    primary: [],
    supporting: [],
    diagnostic: [],
  };

  for (const definition of definitions) {
    byPriority[displayPriorityOf(aspect, definition)].push(definition);
  }

  return {
    primary: byPriority.primary,
    supporting: groupByDimension(aspect, byPriority.supporting),
    diagnostic: groupByDimension(aspect, byPriority.diagnostic),
  };
};

export const validateMetricPresentation = (dictionary) => {
  const errors = [];
  const aspectIds = new Set();
  const metricIds = new Set();

  for (const aspect of dictionary.aspects ?? []) {
    if (aspectIds.has(aspect.id)) errors.push(`duplicate aspect id: ${aspect.id}`);
    aspectIds.add(aspect.id);

    const dimensionIds = new Set();
    for (const dimension of aspect.dimensions ?? []) {
      if (dimensionIds.has(dimension.id)) {
        errors.push(`duplicate dimension id in ${aspect.id}: ${dimension.id}`);
      }
      dimensionIds.add(dimension.id);
    }
  }

  const aspectsById = new Map((dictionary.aspects ?? []).map((aspect) => [aspect.id, aspect]));
  for (const definition of dictionary.metrics ?? []) {
    if (metricIds.has(definition.id)) errors.push(`duplicate metric id: ${definition.id}`);
    metricIds.add(definition.id);

    const aspect = aspectsById.get(definition.aspect);
    if (!aspect) {
      errors.push(`unknown aspect for ${definition.id}: ${definition.aspect}`);
      continue;
    }
    if (!DISPLAY_PRIORITIES.has(definition.displayPriority)) {
      errors.push(`invalid displayPriority for ${definition.id}: ${definition.displayPriority}`);
    }
    if (!(aspect.dimensions ?? []).some((dimension) => dimension.id === definition.dimension)) {
      errors.push(`unknown dimension for ${definition.id}: ${definition.dimension}`);
    }
  }

  for (const aspect of dictionary.aspects ?? []) {
    const definitions = (dictionary.metrics ?? []).filter((definition) => definition.aspect === aspect.id);
    const northStar = definitions.find((definition) => definition.id === aspect.northStar);
    if (!northStar) errors.push(`missing northStar for ${aspect.id}: ${aspect.northStar}`);
    else if (northStar.displayPriority !== 'primary') {
      errors.push(`northStar must be primary for ${aspect.id}: ${aspect.northStar}`);
    }
    const primaryCount = definitions.filter((definition) => definition.displayPriority === 'primary').length;
    if (primaryCount === 0 || primaryCount > 4) {
      errors.push(`${aspect.id} must have 1-4 primary metrics, found ${primaryCount}`);
    }
  }

  return errors;
};
