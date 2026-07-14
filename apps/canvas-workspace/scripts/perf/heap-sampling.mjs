const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Force two V8 GC passes and read the retained heap through CDP. Every step is
 * required evidence: a failed GC or heap read must abort instead of turning a
 * live-heap sample into a misleading retained-heap metric.
 */
export const sampleRetainedHeapMB = async (cdp, { settleMs = 150 } = {}) => {
  try {
    await cdp.send('HeapProfiler.collectGarbage');
    await cdp.send('HeapProfiler.collectGarbage');
  } catch (error) {
    throw new Error(`CDP heap GC failed: ${error?.message ?? String(error)}`);
  }
  if (settleMs > 0) await wait(settleMs);

  let usage;
  try {
    usage = await cdp.send('Runtime.getHeapUsage');
  } catch (error) {
    throw new Error(`CDP heap sample failed: ${error?.message ?? String(error)}`);
  }
  if (!Number.isFinite(usage?.usedSize) || usage.usedSize <= 0) {
    throw new Error(`CDP heap sample returned invalid usedSize: ${String(usage?.usedSize)}`);
  }
  const heapMB = Math.round((usage.usedSize / 1048576) * 10) / 10;
  if (!Number.isFinite(heapMB) || heapMB <= 0) {
    throw new Error(`CDP heap sample produced invalid MB value: ${String(heapMB)}`);
  }
  return heapMB;
};
