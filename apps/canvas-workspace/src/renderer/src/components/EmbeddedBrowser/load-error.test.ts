import { describe, expect, it } from 'vitest';
import { classifyLoadError, loadErrorDetail } from './load-error';

describe('classifyLoadError', () => {
  it('returns null when there is no error', () => {
    expect(classifyLoadError(null)).toBeNull();
  });

  it('recognises embedding refusals', () => {
    expect(classifyLoadError({ code: -27, description: 'ERR_BLOCKED_BY_RESPONSE' })).toBe('blocked');
    expect(classifyLoadError({ description: 'ERR_BLOCKED_BY_CSP' })).toBe('blocked');
    expect(classifyLoadError({ description: 'Refused to display in a frame' })).toBe('blocked');
  });

  it('recognises connectivity failures', () => {
    expect(classifyLoadError({ code: -105, description: 'ERR_NAME_NOT_RESOLVED' })).toBe('network');
    expect(classifyLoadError({ description: 'ERR_INTERNET_DISCONNECTED' })).toBe('network');
    expect(classifyLoadError({ code: -7, description: '' })).toBe('network');
  });

  it('recognises guest process death, which arrives as an exit reason', () => {
    // render-process-gone reports `reason` in the description slot; the exit
    // code there is NOT a net error and must not be read as one.
    expect(classifyLoadError({ code: 11, description: 'crashed' })).toBe('crashed');
    expect(classifyLoadError({ description: 'oom' })).toBe('crashed');
  });

  it('falls back to unknown rather than guessing', () => {
    expect(classifyLoadError({ code: -400, description: 'ERR_SOMETHING_NEW' })).toBe('unknown');
    expect(classifyLoadError({})).toBe('unknown');
  });
});

describe('loadErrorDetail', () => {
  it('pairs the description with the code when both exist', () => {
    expect(loadErrorDetail({ code: -105, description: 'ERR_NAME_NOT_RESOLVED' }))
      .toBe('ERR_NAME_NOT_RESOLVED (-105)');
  });

  it('degrades to whichever half is present', () => {
    expect(loadErrorDetail({ description: 'ERR_FAILED' })).toBe('ERR_FAILED');
    expect(loadErrorDetail({ code: -2 })).toBe('-2');
    expect(loadErrorDetail({})).toBe('');
    expect(loadErrorDetail(null)).toBe('');
  });
});
