import { describe, expect, it } from 'vitest';

import { isGoogleAuthUrl } from '../google-auth';

describe('isGoogleAuthUrl', () => {
  it('matches only the exact Google auth hosts over https', () => {
    expect(isGoogleAuthUrl('https://accounts.google.com/signin')).toBe(true);
    expect(isGoogleAuthUrl('https://accounts.youtube.com/accounts/SetSID')).toBe(true);
    // Lookalike/suffix hosts must never pass — this check loosens link policy.
    expect(isGoogleAuthUrl('https://accounts.google.com.evil.example/signin')).toBe(false);
    expect(isGoogleAuthUrl('https://evilaccounts.google.com.example/')).toBe(false);
    expect(isGoogleAuthUrl('http://accounts.google.com/signin')).toBe(false);
    expect(isGoogleAuthUrl('https://www.google.com/')).toBe(false);
    expect(isGoogleAuthUrl('not a url')).toBe(false);
  });
});
