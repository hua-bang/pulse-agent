import { HarnessError } from './errors.mjs';

export function assertPoint(point) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new HarnessError(point?.error ?? 'Could not resolve a click point.');
  }
}

export function parseKeyCombo(combo) {
  const parts = combo.split('+').map((part) => part.trim()).filter(Boolean);
  let modifiers = 0;
  const key = parts.pop();
  for (const part of parts) {
    const lower = part.toLowerCase();
    if (lower === 'alt' || lower === 'option') modifiers |= 1;
    else if (lower === 'ctrl' || lower === 'control') modifiers |= 2;
    else if (lower === 'meta' || lower === 'cmd' || lower === 'command') modifiers |= 4;
    else if (lower === 'shift') modifiers |= 8;
    else throw new HarnessError(`Unsupported modifier: ${part}`);
  }
  if (!key) throw new HarnessError(`Invalid key combo: ${combo}`);
  const special = {
    Enter: { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 },
    Escape: { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 },
    Esc: { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 },
    Tab: { key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 },
    Backspace: { key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 },
    Delete: { key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 },
    Space: { key: ' ', code: 'Space', windowsVirtualKeyCode: 32 },
  };
  const mapped = special[key] ?? (
    key.length === 1
      ? { key: key.toLowerCase(), code: `Key${key.toUpperCase()}`, windowsVirtualKeyCode: key.toUpperCase().charCodeAt(0) }
      : { key, code: key, windowsVirtualKeyCode: 0 }
  );
  return {
    ...mapped,
    modifiers,
    text: modifiers === 0 && mapped.key.length === 1 ? mapped.key : undefined,
  };
}
