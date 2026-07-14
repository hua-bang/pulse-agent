import { describe, expect, it } from 'vitest';
import {
  WEBVIEW_FIXTURE_INSTANCE_TOKEN,
  WEBVIEW_FIXTURE_READY_MARKER,
  startWebviewFixtureServer,
} from './webview-fixture-server.mjs';

describe('webview fixture server', () => {
  it('serves a self-contained fixture from a random IPv4 loopback port', async () => {
    const fixture = await startWebviewFixtureServer();

    try {
      const baseUrl = new URL(fixture.baseUrl);
      expect(baseUrl.hostname).toBe('127.0.0.1');
      expect(Number(baseUrl.port)).toBeGreaterThan(0);

      const response = await fetch(fixture.urlFor('node / <alpha>'));
      const html = await response.text();

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('text/html; charset=utf-8');
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(html).toContain(`window.${WEBVIEW_FIXTURE_READY_MARKER} = true`);
      expect(html).toContain(`window.${WEBVIEW_FIXTURE_INSTANCE_TOKEN} =`);
      expect(html).toContain('crypto.randomUUID');
      expect(html).toContain("document.documentElement.dataset.pulsePerfWebviewReady = 'true'");
      expect(html).toContain('node / &lt;alpha&gt;');
      expect(html).not.toMatch(/(?:src|href)=["']https?:/i);
    } finally {
      await fixture.close();
    }
  });

  it('rejects unknown routes and unsupported methods', async () => {
    const fixture = await startWebviewFixtureServer();

    try {
      const missing = await fetch(`${fixture.baseUrl}/missing`);
      const unsupported = await fetch(fixture.urlFor('method-check'), { method: 'POST' });

      expect(missing.status).toBe(404);
      expect(unsupported.status).toBe(405);
      expect(unsupported.headers.get('allow')).toBe('GET');
      expect(() => fixture.urlFor('')).toThrow(/non-empty/);
    } finally {
      await fixture.close();
    }
  });

  it('closes idempotently and releases its listening port', async () => {
    const fixture = await startWebviewFixtureServer();
    const url = fixture.urlFor('close-check');

    await Promise.all([fixture.close(), fixture.close()]);

    await expect(fetch(url)).rejects.toThrow();
  });
});
