interface ShortcutParts {
  key: string;
  mod?: boolean;
  /** Literal Control on every platform (rendered ⌃ on Apple keyboards). */
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
}

export const usesAppleShortcuts = (): boolean => {
  if (typeof navigator === 'undefined') return false;
  return /Mac|iPhone|iPad|iPod/i.test(`${navigator.platform} ${navigator.userAgent}`);
};

export const formatShortcut = ({
  key,
  mod = false,
  ctrl = false,
  alt = false,
  shift = false,
}: ShortcutParts): string => {
  if (usesAppleShortcuts()) {
    return `${ctrl ? '⌃' : ''}${mod ? '⌘' : ''}${alt ? '⌥' : ''}${shift ? '⇧' : ''}${key}`;
  }

  return [
    mod || ctrl ? 'Ctrl' : '',
    alt ? 'Alt' : '',
    shift ? 'Shift' : '',
    key,
  ].filter(Boolean).join('+');
};
