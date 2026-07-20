/**
 * Host side of the artifact runtime-capability bridge (trust model in
 * shared/artifact-capabilities.ts). The page gets a HOST-AUTHORED script
 * prepended to its srcDoc — it can call `window.pulseArtifact.*`, but the
 * exposed set comes from the artifact RECORD's declared capabilities, calls
 * require a real user gesture, and main re-validates everything.
 */

import {
  ARTIFACT_CAPABILITY_MESSAGE,
  ARTIFACT_CAPABILITY_RESPONSE,
} from '../../../../shared/artifact-capabilities';

export function buildCapabilityBridgeScript(capabilities: string[]): string {
  const script = `(() => {
  const CAPS = new Set(${JSON.stringify(capabilities)});
  const pending = new Map();
  let seq = 0;
  window.addEventListener('message', (event) => {
    const data = event.data;
    if (!data || data.type !== ${JSON.stringify(ARTIFACT_CAPABILITY_RESPONSE)}) return;
    const entry = pending.get(data.id);
    if (!entry) return;
    pending.delete(data.id);
    entry(data.result || { ok: false, error: 'empty result' });
  });
  const call = (capability, payload) => {
    if (!CAPS.has(capability)) {
      return Promise.resolve({ ok: false, error: 'capability not granted: ' + capability });
    }
    if (!(navigator.userActivation && navigator.userActivation.isActive)) {
      return Promise.resolve({ ok: false, error: 'requires a user gesture (click)' });
    }
    const id = 'cap-' + (++seq) + '-' + Date.now();
    return new Promise((resolve) => {
      pending.set(id, resolve);
      setTimeout(() => { const p = pending.get(id); if (p) { pending.delete(id); p({ ok: false, error: 'timeout' }); } }, 15000);
      window.parent.postMessage({ type: ${JSON.stringify(ARTIFACT_CAPABILITY_MESSAGE)}, id, capability, payload }, '*');
    });
  };
  window.pulseArtifact = {
    capabilities: Array.from(CAPS),
    memory: { adopt: (payload) => call('memory.adopt', payload) },
    skill: { save: (payload) => call('skill.save', payload) },
  };
})();`;
  return `<script>${script}</script>\n`;
}
