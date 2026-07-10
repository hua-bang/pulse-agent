/**
 * Rule engine for the performance dashboard (Rsdoctor/Lighthouse-style).
 *
 * Input: metric dictionary + current snapshot + prior history snapshots.
 * Output: alerts — each with severity, evidence, an actionable suggestion,
 * and the report finding it traces back to. The dashboard renders alerts
 * as the conclusion layer; raw metrics become the evidence layer below.
 *
 * severity: 'high' (act now / gate broken) · 'medium' (known cost, fix
 * planned) · 'info' (context: coverage gaps, unstable samples).
 */

const INTERACTION_CONTEXT = {
  typing: { label: '打字', event: '按键' },
  drag: { label: '拖拽', event: '指针移动' },
  resize: { label: '调整尺寸', event: '指针移动' },
};

export const evaluateRules = (dictionary, snapshot, history, policyContext = {}) => {
  const alerts = [];
  const byId = new Map(snapshot.metrics.map((m) => [m.id, m]));
  const previous = history
    .filter((h) => h.timestamp < snapshot.timestamp)
    .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))[0] ?? null;
  const prevOf = (id) => previous?.metrics.find((m) => m.id === id)?.value;

  // 1. Broken gates — always the loudest signal.
  for (const def of dictionary.metrics) {
    const entry = byId.get(def.id);
    if (entry?.pass === false) {
      const gateOperator = { min: '≥', max: '≤', ratchet: '≤', exact: '=', true: '=' }[entry.gateOperator] ?? '≤';
      const evidence = entry.missingConfig
        ? '门禁阈值配置缺失'
        : entry.missing
          ? '场景未产出计数器值'
          : `当前 ${entry.value}${def.unit !== 'bool' ? ` ${def.unit}` : ''},Gate ${gateOperator} ${entry.limit ?? '—'}`;
      const suggestion = entry.missingConfig
        ? '恢复 metrics.json 中 gate 指标对应的 baselines.json policy.gate 配置。'
        : entry.missing
          ? '检查场景是否执行完整、计数器是否启用,不得用缺失值代替 0。'
          : '定位引入回归的提交(对比 perf/history),修复或在有充分理由时同 PR 调整基线。';
      alerts.push({
        severity: 'high', aspect: def.aspect,
        title: `门禁失败:${def.label}`,
        evidence,
        suggestion,
        ref: def.id,
      });
    }
  }
  for (const def of dictionary.metrics) {
    if (byId.has(def.id)) continue;
    const policy = policyContext.policiesById?.[def.id];
    if (policy?.gateStatus !== 'unavailable') continue;
    alerts.push({
      severity: 'high', aspect: def.aspect,
      title: `门禁失败:${def.label}`,
      evidence: '适用 Gate 指标未产出',
      suggestion: '检查本次报告 scope、场景执行和指标采集映射;缺失值不得当作 0 或跳过 Gate。',
      ref: def.id,
    });
  }

  // 2. Product targets — independent from regression Gates. Only P0 misses
  // become alerts; supporting targets stay visible in their metric rows.
  for (const def of dictionary.metrics.filter(
    (metric) => metric.displayPriority === 'primary' && ['warn', 'gate'].includes(metric.level),
  )) {
    const entry = byId.get(def.id);
    if (!entry || entry.pass === false || entry.policy?.status !== 'missed') continue;
    const policy = entry.policy;
    alerts.push({
      severity: 'medium', aspect: def.aspect,
      title: `目标未达:${def.label}`,
      evidence: `当前 ${entry.value}${def.unit !== 'bool' ? ` ${def.unit}` : ''},目标 ${policy.target}${def.unit !== 'bool' ? ` ${def.unit}` : ''},差 ${Math.abs(policy.headroom ?? 0)}${def.unit !== 'bool' ? ` ${def.unit}` : ''}`,
      suggestion: `先定位该指标的主要耗时/体积来源;目标依据:${policy.basis ?? '见 perf/baselines.json'}。目标不等同于 Gate,不自动阻断提交。`,
      ref: def.id,
    });
  }

  // 3. Unstable timing samples — protect consumers from single-run noise.
  for (const def of dictionary.metrics.filter(
    (d) => d.comparability === '同机' && d.coverageClass !== 'diagnostic',
  )) {
    const entry = byId.get(def.id);
    const prev = prevOf(def.id);
    if (!entry || typeof entry.value !== 'number' || typeof prev !== 'number' || prev === 0) continue;
    const ratio = entry.value / prev;
    if (ratio > 2 || ratio < 0.5) {
      alerts.push({
        severity: 'info', aspect: def.aspect,
        title: `样本波动大,勿单看:${def.label}`,
        evidence: `本次 ${entry.value} ${def.unit},上次同机 ${prev} ${def.unit}(${ratio > 1 ? '×' + ratio.toFixed(1) : '÷' + (1 / ratio).toFixed(1)})`,
        suggestion: '时间类指标单样本方差大;结论以 --repeat N 中位数为准(M1),或重跑确认。',
        ref: def.id,
      });
    }
  }

  // 4. Known amplifiers still active — counter ≈ event count.
  for (const [scenario, events, finding, expect] of [
    ['typing', 120, 'I-1(每 keystroke 全文序列化 + 整数组替换)', '< 20'],
    ['drag', 90, 'A2(每 pointer-move 整数组替换)', '< 10'],
    ['resize', 90, 'A2 resize(每 pointer-move 整数组替换)', '< 10'],
  ]) {
    const counter = byId.get(`interact.${scenario}.counter.nodes_array_replace`);
    if (counter && counter.value >= events * 0.9) {
      const context = INTERACTION_CONTEXT[scenario];
      alerts.push({
        severity: 'medium', aspect: 'interact',
        title: `放大器仍在:${context.label}每次${context.event}都全量替换 nodes 数组`,
        evidence: `${counter.value} 次替换 / ${events} 次${context.event} ≈ 1:1 — 实证 ${finding}`,
        suggestion: `修复后(debounce / 手势期 ephemeral 几何)预期 ${expect},同 PR 下调计数器 max 锁定收益。`,
        ref: finding.split('(')[0],
      });
    }
  }

  // 5. Frame budget blown during interaction.
  for (const scenario of ['typing', 'drag', 'resize']) {
    const frames = byId.get(`interact.${scenario}.frames_over20_pct`);
    if (frames && frames.value > 20) {
      alerts.push({
        severity: 'medium', aspect: 'interact',
        title: `${INTERACTION_CONTEXT[scenario].label}期间 ${frames.value}% 的帧超 20ms`,
        evidence: `场景条件:${snapshot.env.seedNodes ?? '默认'} 节点画布;同场景 3 节点画布为 ~0%`,
        suggestion: '规模放大来自 nodes 数组全量替换的下游重渲(见放大器告警);修 I-1 / A2(拖拽、调整尺寸)是根因解。',
        ref: `interact.${scenario}.frames_over20_pct`,
      });
    }
  }

  // 6. Coverage gaps — aspects with no measured metric at all.
  for (const aspect of dictionary.aspects) {
    const defs = dictionary.metrics.filter((m) => m.aspect === aspect.id);
    if (!defs.some((d) => byId.has(d.id))) {
      alerts.push({
        severity: 'info', aspect: aspect.id,
        title: `专项「${aspect.name}」尚无任何实测数据`,
        evidence: `${defs.length} 个指标全部未采集`,
        suggestion: aspect.next,
        ref: aspect.id,
      });
    }
  }

  const order = { high: 0, medium: 1, info: 2 };
  alerts.sort((a, b) => order[a.severity] - order[b.severity]);
  return { alerts, previous };
};

/** One-line machine-generated verdict for the overview header. */
export const buildVerdict = (dictionary, snapshot, alerts, policyContext = {}) => {
  const high = alerts.filter((a) => a.severity === 'high').length;
  const byId = new Map(snapshot.metrics.map((metric) => [metric.id, metric]));
  const p0Statuses = dictionary.metrics
    .filter((definition) => definition.displayPriority === 'primary')
    .map((definition) => byId.get(definition.id)?.policy?.status)
    .filter((status) => ['met', 'near-warning', 'missed'].includes(status));
  const met = p0Statuses.filter((status) => status === 'met').length;
  const nearWarning = p0Statuses.filter((status) => status === 'near-warning').length;
  const missed = p0Statuses.filter((status) => status === 'missed').length;
  const gated = snapshot.metrics.filter((m) => m.pass !== undefined);
  const passed = policyContext.gateSummary?.passed ?? gated.filter((m) => m.pass).length;
  const gateTotal = policyContext.gateSummary?.total ?? gated.length;
  const summary = `P0 目标 ${met}/${p0Statuses.length} 达标(${nearWarning} 接近预警,${missed} 未达标) · Gate ${passed}/${gateTotal} 通过`;
  if (high > 0) return `⚠ ${summary};${high} 项 high 回归需优先处理。`;
  return `${summary};无 high 回归。`;
};
