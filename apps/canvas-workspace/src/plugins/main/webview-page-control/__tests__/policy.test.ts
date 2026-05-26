import { describe, it, expect } from 'vitest';
import { evaluateActionPolicyWith } from '../policy';

describe('evaluateActionPolicyWith', () => {
  describe('defaults', () => {
    it('allows http and https URLs on neutral hosts', () => {
      expect(evaluateActionPolicyWith('https://example.com/foo', {}).allow).toBe(true);
      expect(evaluateActionPolicyWith('http://example.com', {}).allow).toBe(true);
      expect(evaluateActionPolicyWith('https://github.com/anthropics/x', {}).allow).toBe(true);
    });

    it('allows about:blank', () => {
      expect(evaluateActionPolicyWith('about:blank', {}).allow).toBe(true);
    });

    it('denies non-web schemes', () => {
      const cases = [
        'file:///etc/passwd',
        'chrome://settings',
        'chrome-extension://abc/foo.html',
        'devtools://devtools/bundled/x.html',
        'view-source:https://example.com',
        'data:text/html,<h1>x</h1>',
        'javascript:alert(1)',
      ];
      for (const url of cases) {
        const d = evaluateActionPolicyWith(url, {});
        expect(d.allow, `expected ${url} to be denied`).toBe(false);
        expect(d.reason).toBeTruthy();
      }
    });

    it('denies ws/mailto/other non-http schemes', () => {
      expect(evaluateActionPolicyWith('mailto:foo@bar.com', {}).allow).toBe(false);
      expect(evaluateActionPolicyWith('ws://example.com', {}).allow).toBe(false);
    });

    it('denies built-in sensitive domains', () => {
      const cases = [
        'https://mybank.com/login',
        'https://www.paypal.com',
        'https://accounts.google.com/signin',
        'https://mail.google.com/inbox',
        'https://login.live.com',
        'https://appleid.apple.com',
        'https://login.microsoftonline.com',
      ];
      for (const url of cases) {
        const d = evaluateActionPolicyWith(url, {});
        expect(d.allow, `expected ${url} to be denied`).toBe(false);
        expect(d.reason).toMatch(/deny pattern/);
      }
    });

    it('rejects empty / unparseable URLs', () => {
      expect(evaluateActionPolicyWith('', {}).allow).toBe(false);
      expect(evaluateActionPolicyWith('not a url', {}).allow).toBe(false);
      expect(evaluateActionPolicyWith('http://', {}).allow).toBe(false);
    });
  });

  describe('config overrides', () => {
    it('respects custom denySchemes (overrides defaults)', () => {
      // Empty list → no schemes blocked except the http(s)-only floor.
      expect(evaluateActionPolicyWith('file:///x', { denySchemes: [] }).allow).toBe(false);
      // Only http and https pass even with empty denySchemes, because we
      // enforce http(s)-only after the scheme check.
      expect(evaluateActionPolicyWith('ftp://example.com', { denySchemes: [] }).allow).toBe(false);
    });

    it('respects custom denyHostPatterns (overrides defaults)', () => {
      const cfg = { denyHostPatterns: ['*evil*'] };
      // Default-blocked host now passes because we replaced the list.
      expect(evaluateActionPolicyWith('https://mail.google.com', cfg).allow).toBe(true);
      expect(evaluateActionPolicyWith('https://evil.example.com', cfg).allow).toBe(false);
      expect(evaluateActionPolicyWith('https://www.evil.com', cfg).allow).toBe(false);
    });

    it('allowHostPatterns acts as a strict allowlist when non-empty', () => {
      const cfg = { allowHostPatterns: ['example.com', '*.allowed.org'] };
      expect(evaluateActionPolicyWith('https://example.com/page', cfg).allow).toBe(true);
      expect(evaluateActionPolicyWith('https://foo.allowed.org', cfg).allow).toBe(true);
      expect(evaluateActionPolicyWith('https://github.com', cfg).allow).toBe(false);
    });

    it('allowHostPatterns is ignored when empty array', () => {
      const cfg = { allowHostPatterns: [] };
      expect(evaluateActionPolicyWith('https://github.com', cfg).allow).toBe(true);
    });

    it('deny patterns win over allow patterns', () => {
      const cfg = {
        denyHostPatterns: ['*bank*'],
        allowHostPatterns: ['*'],
      };
      expect(evaluateActionPolicyWith('https://mybank.com', cfg).allow).toBe(false);
      expect(evaluateActionPolicyWith('https://example.com', cfg).allow).toBe(true);
    });

    it('ignores non-string entries instead of crashing on .toLowerCase()', () => {
      // Hand-built config bypassing the loader's normalisation. Should
      // skip non-string entries cleanly rather than throw, so a typo in
      // user JSON degrades to "treated as no extra rule" rather than
      // bricking the tool entirely.
      const cfg = {
        denyHostPatterns: ['*bank*', 123 as unknown as string, null as unknown as string],
        allowHostPatterns: ['example.com', 42 as unknown as string],
      };
      expect(() => evaluateActionPolicyWith('https://example.com', cfg)).not.toThrow();
      expect(evaluateActionPolicyWith('https://example.com', cfg).allow).toBe(true);
      expect(evaluateActionPolicyWith('https://mybank.com', cfg).allow).toBe(false);
    });
  });

  describe('default-list coverage', () => {
    it('blocks Auth0 tenant subdomains, not only the exact apex', () => {
      // Tenant logins live on subdomains like tenant.us.auth0.com — the
      // exact-only pattern previously let them through.
      expect(evaluateActionPolicyWith('https://auth0.com', {}).allow).toBe(false);
      expect(evaluateActionPolicyWith('https://tenant.us.auth0.com', {}).allow).toBe(false);
      expect(evaluateActionPolicyWith('https://example.auth0.com/login', {}).allow).toBe(false);
    });
  });

  describe('host matching', () => {
    it('matches case-insensitively', () => {
      const cfg = { denyHostPatterns: ['EXAMPLE.com'] };
      expect(evaluateActionPolicyWith('https://example.com', cfg).allow).toBe(false);
      expect(evaluateActionPolicyWith('https://EXAMPLE.com', cfg).allow).toBe(false);
    });

    it('exact match does not catch subdomains', () => {
      const cfg = { denyHostPatterns: ['example.com'] };
      expect(evaluateActionPolicyWith('https://example.com', cfg).allow).toBe(false);
      expect(evaluateActionPolicyWith('https://foo.example.com', cfg).allow).toBe(true);
    });

    it('wildcard matches subdomains', () => {
      const cfg = { denyHostPatterns: ['*.example.com'] };
      expect(evaluateActionPolicyWith('https://example.com', cfg).allow).toBe(true);
      expect(evaluateActionPolicyWith('https://foo.example.com', cfg).allow).toBe(false);
      expect(evaluateActionPolicyWith('https://a.b.example.com', cfg).allow).toBe(false);
    });

    it('regex special chars in patterns are escaped (no injection)', () => {
      const cfg = { denyHostPatterns: ['foo.bar'] };
      // The "." in the pattern should be matched literally, not as "any char".
      expect(evaluateActionPolicyWith('https://fooXbar', cfg).allow).toBe(true);
      expect(evaluateActionPolicyWith('https://foo.bar', cfg).allow).toBe(false);
    });
  });
});
