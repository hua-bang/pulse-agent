// Each @phosphor-icons/react `dist/defs/<Icon>.es.js` module holds a Map with
// all six weights of the icon. Canvas renders only regular, bold, fill and
// duotone, so the renderer build drops the thin and light entries. The guard
// test in phosphor-weights.test.mjs fails if source code starts to use them.
export const STRIPPED_PHOSPHOR_WEIGHTS = ['thin', 'light'];

const DEF_MODULE = /@phosphor-icons\/react\/dist\/defs\/[^/]+\.es\.js$/;

const entryPattern = (weight) => new RegExp(`\\n  \\[\\n    "${weight}",[\\s\\S]*?\\n  \\],?`);

/** Removes the stripped weights from one def module. Returns null if the
 *  module does not have the expected layout, so the build keeps it unchanged. */
export const stripPhosphorWeights = (code) => {
  let next = code;
  for (const weight of STRIPPED_PHOSPHOR_WEIGHTS) {
    const pattern = entryPattern(weight);
    if (!pattern.test(next)) return null;
    next = next.replace(pattern, '');
  }
  return next;
};

export const phosphorWeightsPlugin = () => ({
  name: 'pulse-canvas-phosphor-weights',
  apply: 'build',
  transform(code, id) {
    if (!DEF_MODULE.test(id)) return null;
    const stripped = stripPhosphorWeights(code);
    if (stripped === null) {
      this.warn(`phosphor def layout changed; kept all weights in ${id}`);
      return null;
    }
    return { code: stripped, map: null };
  },
});
