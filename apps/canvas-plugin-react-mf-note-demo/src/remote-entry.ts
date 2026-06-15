import plugin from './plugin';
import type { GlobalRemoteContainer } from './types';

const remoteName = 'pulse_canvas_demo_note';

const container: GlobalRemoteContainer = {
  init() {},
  get(expose) {
    if (expose !== './plugin' && expose !== '.') {
      return Promise.reject(new Error(`[${remoteName}] unknown expose: ${expose}`));
    }
    return Promise.resolve(() => ({
      default: plugin,
      plugin,
    }));
  },
};

(globalThis as typeof globalThis & Record<string, unknown>)[remoteName] = container;

export default container;
