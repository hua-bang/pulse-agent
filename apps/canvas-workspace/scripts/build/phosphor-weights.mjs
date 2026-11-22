// Each @phosphor-icons/react `dist/defs/<Icon>.es.js` module holds a Map with
// all six weights of the icon. Canvas never uses thin or light, and only a
// small allowlist of icons uses bold, so the renderer build strips unused
// weights. The guard test in phosphor-weights.test.mjs fails if source code
// starts to use a stripped weight.
export const STRIPPED_PHOSPHOR_WEIGHTS = ['thin', 'light'];
export const BOLD_PHOSPHOR_ICONS = new Set([
  'CaretDown',
  'DotsSixVertical',
  'DotsThree',
  'TextB',
]);

const DEF_MODULE = /@phosphor-icons\/react\/dist\/defs\/([^/]+)\.es\.js$/;

const entryPattern = (weight) => new RegExp(`\\n  \\[\\n    "${weight}",[\\s\\S]*?\\n  \\],?`);

/** Removes the stripped weights from one def module. Returns null if the
 *  module does not have the expected layout, so the build keeps it unchanged. */
export const stripPhosphorWeights = (code, iconName) => {
  const weights = iconName && !BOLD_PHOSPHOR_ICONS.has(iconName)
    ? [...STRIPPED_PHOSPHOR_WEIGHTS, 'bold']
    : STRIPPED_PHOSPHOR_WEIGHTS;
  let next = code;
  for (const weight of weights) {
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
    const match = DEF_MODULE.exec(id);
    if (!match) return null;
    const stripped = stripPhosphorWeights(code, match[1]);
    if (stripped === null) {
      this.warn(`phosphor def layout changed; kept all weights in ${id}`);
      return null;
    }
    return { code: stripped, map: null };
  },
});
