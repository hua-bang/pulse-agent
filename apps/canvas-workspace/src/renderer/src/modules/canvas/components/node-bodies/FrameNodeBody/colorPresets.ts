/** Frames X Light Colors, palette A: seven 300-step titles with 50-step bodies.
 * Exact values read from Figma's Selection colors variable labels.
 * Existing preset IDs remain stable; retired families resolve below.
 * Source: figma.com/design/05ulLHq9f9iizGUroh5Lt4?node-id=5882-129399
 */
export const FRAME_COLOR_PRESETS = [
  { name: 'Blue', hue: 241, value: 'oklch(0.68 0.108 241)', accent: '#91C3FD', title: '#91C3FD', fill: '#F2F7FF', focusFill: '#DCEBFE', border: '#DCEBFE', titleBorder: '#91C3FD', text: '#3F3F46' },
  { name: 'Emerald', hue: 168, value: 'oklch(0.68 0.108 168)', accent: '#6EE7B7', title: '#6EE7B7', fill: '#F0FDF7', focusFill: '#C8F9E0', border: '#C8F9E0', titleBorder: '#6EE7B7', text: '#3F3F46' },
  { name: 'Violet', hue: 306, value: 'oklch(0.68 0.108 306)', accent: '#B7A6FD', title: '#B7A6FD', fill: '#F7F6FF', focusFill: '#E2DDFE', border: '#E2DDFE', titleBorder: '#B7A6FD', text: '#3F3F46' },
  { name: 'Orange', hue: 48, value: 'oklch(0.68 0.108 48)', accent: '#FDBA72', title: '#FDBA72', fill: '#FFF6EB', focusFill: '#FFEDD6', border: '#FFEDD6', titleBorder: '#FDBA72', text: '#3F3F46' },
  { name: 'Rose', hue: 6, value: 'oklch(0.68 0.108 6)', accent: '#FD9BA6', title: '#FD9BA6', fill: '#FFF0F1', focusFill: '#FFE5E7', border: '#FFE5E7', titleBorder: '#FD9BA6', text: '#3F3F46' },
  { name: 'Yellow', hue: 96, value: 'oklch(0.68 0.108 96)', accent: '#FFE561', title: '#FFE561', fill: '#FEFCE7', focusFill: '#FEF9C3', border: '#FEF9C3', titleBorder: '#FFE561', text: '#3F3F46' },
  { name: 'Blue Gray', hue: 265, value: 'oklch(0.68 0.006 265)', accent: '#C8D6E5', title: '#C8D6E5', fill: '#F8FAFC', focusFill: '#F1F5F9', border: '#F1F5F9', titleBorder: '#C8D6E5', text: '#3F3F46' },
];

const LEGACY_PRESET_ALIASES: Record<string, string> = {
  'oklch(0.68 0.108 261)': 'oklch(0.68 0.108 241)',
  'oklch(0.68 0.108 200)': 'oklch(0.68 0.108 168)',
};

export const resolveFramePalette = (color: string) => {
  const value = LEGACY_PRESET_ALIASES[color] ?? color;
  return FRAME_COLOR_PRESETS.find((preset) => preset.value === value || preset.accent === value);
};

export const resolveFrameAccent = (color: string): string =>
  resolveFramePalette(color)?.accent ?? color;
