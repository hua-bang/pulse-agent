import { useDockKeyboard, type DockKeyboardOptions } from './useDockKeyboard';

/** Loads browser-style shortcut handling only while the dock is in use. */
export const DockKeyboardController = (options: DockKeyboardOptions) => {
  useDockKeyboard(options);
  return null;
};
