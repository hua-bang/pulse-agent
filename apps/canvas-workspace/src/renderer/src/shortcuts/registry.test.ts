import { describe, expect, it } from 'vitest';
import { SHORTCUT_HELP, SHORTCUT_SECTIONS } from '../components/AppShellProvider/ShortcutsDialog';
import { usesAppleShortcuts } from '../utils/keyboardShortcut';
import { WEBVIEW_FORWARDED_CHORDS } from '../../../shared/webview-shortcuts';
import {
  SHORTCUTS,
  formatBinding,
  matchShortcut,
  matchesBinding,
  type KeyBinding,
  type ShortcutId,
  type ShortcutDefinition,
} from './registry';

const definitions = Object.entries(SHORTCUTS) as Array<[ShortcutId, ShortcutDefinition]>;

const event = (overrides: Partial<KeyboardEvent> & { key: string }) => ({
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...overrides,
});

const bindingSignature = (binding: KeyBinding): string =>
  [
    binding.key.toLowerCase(),
    binding.mod ? 'mod' : '',
    binding.ctrl ? 'ctrl' : '',
    binding.alt ? 'alt' : '',
    binding.shift ? 'shift' : '',
  ].join('|');

describe('shortcut registry', () => {
  // Two handlers for one chord means the second is dead code, and which one
  // wins depends on declaration order — exactly the class of bug that let
  // Cmd+Shift+A fall into Cmd+A.
  it('has no colliding chords within a dispatch owner', () => {
    const seen = new Map<string, string>();
    for (const [id, definition] of definitions) {
      for (const binding of definition.bindings) {
        if (!binding.key) continue;
        const signature = `${definition.owner}::${bindingSignature(binding)}`;
        const existing = seen.get(signature);
        expect(existing, `${signature} is bound by both ${existing} and ${id}`)
          .toBeUndefined();
        seen.set(signature, id);
      }
    }
  });

  // macOS never delivers Cmd+H (hide application) or Cmd+Tab (app switcher)
  // to the renderer. Both used to be documented shortcuts that did nothing
  // there; the registry must keep them on literal Ctrl.
  it('keeps macOS-reserved chords off the mod modifier', () => {
    for (const [id, definition] of definitions) {
      for (const binding of definition.bindings) {
        const reserved = binding.key.toLowerCase() === 'h' || binding.key === 'Tab';
        if (!reserved) continue;
        expect(binding.mod, `${id} must not bind Cmd+${binding.key}`).not.toBe(true);
      }
    }
  });

  it('matches modifiers exactly', () => {
    const selectAll = SHORTCUTS['canvas.selectAll'].bindings[0];
    expect(matchesBinding(event({ key: 'a', metaKey: true }), selectAll)).toBe(true);
    expect(matchesBinding(event({ key: 'a', metaKey: true, shiftKey: true }), selectAll)).toBe(false);
    expect(matchesBinding(event({ key: 'a', metaKey: true, altKey: true }), selectAll)).toBe(false);
    expect(matchesBinding(event({ key: 'A', metaKey: true }), selectAll)).toBe(true);
  });

  it('does not match a literal-Ctrl binding when Cmd is held instead', () => {
    const cycle = SHORTCUTS['canvas.cycleNodes'].bindings[0];
    expect(matchesBinding(event({ key: 'Tab', ctrlKey: true }), cycle)).toBe(true);
    expect(matchesBinding(event({ key: 'Tab', metaKey: true }), cycle)).toBe(false);
  });

  it('routes a chord to the owner that declares it', () => {
    expect(matchShortcut(event({ key: 'a', metaKey: true, shiftKey: true }), 'canvas')?.id)
      .toBe('canvas.toggleChatPanel');
    expect(matchShortcut(event({ key: 'a', metaKey: true, shiftKey: true }), 'app')).toBeNull();
    expect(matchShortcut(event({ key: 'l', metaKey: true, shiftKey: true }), 'app')?.id)
      .toBe('app.toggleChatPage');
  });

  // Main cannot import this registry, so the webview forwarding whitelist
  // lives in shared/. This is the check that keeps the copy honest: a chord
  // main swallows and forwards must still be a chord the renderer handles.
  it('forwards only chords the registry actually binds', () => {
    for (const chord of WEBVIEW_FORWARDED_CHORDS) {
      const probe = event({
        key: chord.key,
        metaKey: Boolean(chord.mod),
        ctrlKey: Boolean(chord.ctrl),
        altKey: Boolean(chord.alt),
        shiftKey: Boolean(chord.shift),
      });
      const handled = matchShortcut(probe, 'canvas') ?? matchShortcut(probe, 'app');
      expect(handled, `no registry binding handles forwarded chord ${JSON.stringify(chord)}`)
        .not.toBeNull();
    }
  });

  describe('help overlay derivation', () => {
    it('renders at least one non-empty combo for every row', () => {
      for (const section of SHORTCUT_SECTIONS) {
        for (const item of section.items) {
          expect(item.combos.length, `${section.titleKey} has a row with no combo`).toBeGreaterThan(0);
          for (const combo of item.combos) {
            expect(combo.length, `${section.titleKey} has an empty combo`).toBeGreaterThan(0);
          }
        }
      }
    });

    // Each alternative binding is its own chip group: joining them into one
    // string made the panel split on "+" and render "Ctrl+Tab /
    // Ctrl+Shift+Tab" as the four chips Ctrl | Tab / Ctrl | Shift | Tab.
    it('keeps alternative bindings separate', () => {
      const cycle = SHORTCUT_SECTIONS
        .flatMap((section) => section.items)
        .find((item) => item.descriptionKey === 'shortcuts.canvas.cycleNodes');
      expect(cycle?.combos).toEqual(usesAppleShortcuts()
        ? ['⌃Tab', '⌃⇧Tab']
        : ['Ctrl+Tab', 'Ctrl+Shift+Tab']);
    });

    // The whole point of the registry: a row can only exist if a definition
    // backs it, so the panel can no longer advertise a shortcut nobody
    // implemented.
    it('keeps help metadata exhaustive over the runtime registry', () => {
      expect(Object.keys(SHORTCUT_HELP).sort()).toEqual(Object.keys(SHORTCUTS).sort());
    });

    it('labels bindings for the host platform', () => {
      expect(formatBinding({ key: 'k', mod: true }))
        .toBe(usesAppleShortcuts() ? '⌘K' : 'Ctrl+K');
      expect(formatBinding({ key: 'ArrowUp', shift: true }))
        .toBe(usesAppleShortcuts() ? '⇧↑' : 'Shift+↑');
      expect(formatBinding({ key: '', display: 'Scroll' })).toBe('Scroll');
    });
  });
});
