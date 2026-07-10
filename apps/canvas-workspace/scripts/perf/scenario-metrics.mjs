const median = (nums) => {
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : Math.round(((sorted[mid - 1] + sorted[mid]) / 2) * 10) / 10;
};

/**
 * Fold repeated scenario reports into the stable dashboard contract.
 * Timing leaves use the median, deterministic counters and explicit worst
 * frame values use max, while raw arrays keep the evidence behind both.
 */
export const aggregateReports = (reports) => {
  if (reports.length === 0) throw new Error('aggregateReports requires at least one report');
  if (reports.length === 1) return reports[0];

  const last = reports[reports.length - 1];
  const p95Raw = reports.map((report) => report.interactions.p95);
  const over20Raw = reports.map((report) => report.frames.over20msPct);
  const over20CountRaw = reports.map((report) => report.frames.over20msCount);
  const counterNames = new Set(reports.flatMap((report) => Object.keys(report.counters)));
  const counters = {};
  for (const name of counterNames) {
    counters[name] = Math.max(...reports.map((report) => report.counters[name] ?? 0));
  }
  const counterRaw = reports.map((report) => Object.fromEntries(
    [...counterNames].map((name) => [name, report.counters[name] ?? 0]),
  ));

  const raw = {
    interactionsP95: p95Raw,
    framesOver20Pct: over20Raw,
    framesOver20Count: over20CountRaw,
    counters: counterRaw,
  };
  let wheelToNextFrame;
  if (reports.every((report) => Number.isFinite(report.wheelToNextFrame?.p95))) {
    const wheelP95Raw = reports.map((report) => report.wheelToNextFrame.p95);
    raw.wheelToNextFrameP95 = wheelP95Raw;
    wheelToNextFrame = {
      ...last.wheelToNextFrame,
      p95: median(wheelP95Raw),
      max: Math.max(...reports.map((report) => report.wheelToNextFrame.max)),
    };
  }

  return {
    ...last,
    counters,
    interactions: { ...last.interactions, p95: median(p95Raw) },
    frames: {
      ...last.frames,
      over20msPct: median(over20Raw),
      over20msPctMax: Math.max(...over20Raw),
      over20msCountMax: Math.max(...over20CountRaw),
    },
    ...(wheelToNextFrame ? { wheelToNextFrame } : {}),
    runs: reports.length,
    raw,
  };
};
