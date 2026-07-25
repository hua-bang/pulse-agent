interface ShortcutParts {
  key: string;
  mod?: boolean;
  alt?: boolean;
  shift?: boolean;
}

const usesAppleShortcuts = (): boolean => {
  if (typeof navigator === 'undefined') return false;
  return /Mac|iPhone|iPad|iPod/i.test(`${navigator.platform} ${navigator.userAgent}`);
};

export const formatShortcut = ({
  key,
  mod = false,
  alt = false,
  shift = false,
}: ShortcutParts): string => {
  if (usesAppleShortcuts()) {
    return `${mod ? '⌘' : ''}${alt ? '⌥' : ''}${shift ? '⇧' : ''}${key}`;
  }

  return [
    mod ? 'Ctrl' : '',
    alt ? 'Alt' : '',
    shift ? 'Shift' : '',
    key,
  ].filter(Boolean).join('+');
};
