import { afterEach, describe, expect, it } from 'vitest';
import { createDomPickerScript } from '../webview/dom-snapshot-script';

class FakeElement {
  className = '';
  textContent = '';
  style: Record<string, string> = {};

  constructor(private readonly tag: string) {}

  get tagName(): string {
    return this.tag.toUpperCase();
  }

  getAttribute(): string | null {
    return null;
  }

  appendChild(): never {
    throw new Error('append blocked');
  }

  remove(): void {}

  getBoundingClientRect(): { left: number; top: number; width: number; height: number; bottom: number } {
    return { left: 0, top: 0, width: 10, height: 10, bottom: 10 };
  }
}

function installFakePage(): void {
  Object.assign(globalThis, {
    Element: FakeElement,
    window: {
      CSS: undefined,
      innerHeight: 800,
      innerWidth: 1200,
      scrollX: 0,
      scrollY: 0,
      addEventListener: () => {},
      removeEventListener: () => {},
    },
    document: {
      title: 'Test page',
      documentElement: new FakeElement('html'),
      body: new FakeElement('body'),
      createElement: (tag: string) => new FakeElement(tag),
      addEventListener: () => {},
      removeEventListener: () => {},
      querySelectorAll: () => [],
    },
  });
}

function runScript<T>(script: string): T {
  return (0, eval)(script) as T;
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'Element');
  Reflect.deleteProperty(globalThis, 'window');
  Reflect.deleteProperty(globalThis, 'document');
});

describe('createDomPickerScript', () => {
  it('returns a structured error instead of rejecting when the picker overlay cannot mount', async () => {
    installFakePage();

    await expect(
      runScript<Promise<unknown>>(createDomPickerScript('workspace-1', 'node-1')),
    ).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining('DOM picker failed to start: append blocked'),
    });
  });
});
