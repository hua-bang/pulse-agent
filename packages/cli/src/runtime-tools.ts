import type { Tool } from 'pulse-coder-engine';
import { createJsExecutor, createRunJsTool } from 'pulse-sandbox/src';

import { createCanvasRuntimeTools } from './canvas-runtime-tools.js';

export function createPulseCliTools(
  env: NodeJS.ProcessEnv = process.env,
): Record<string, Tool> {
  const runJsTool = createRunJsTool({ executor: createJsExecutor() });
  return {
    [runJsTool.name]: runJsTool,
    ...(env.PULSE_CODER_EXPERIMENTAL_APP_RUNTIME === '1'
      ? createCanvasRuntimeTools()
      : {}),
  };
}
