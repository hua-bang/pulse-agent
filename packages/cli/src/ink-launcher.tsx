import React from 'react';
import { render } from 'ink';

import { InkCliApp } from './ink-app.js';
import { createInkCoderController } from './ink-controller.js';

export async function startInkTui(): Promise<void> {
  const controller = await createInkCoderController();
  const instance = render(<InkCliApp controller={controller} />);

  await instance.waitUntilExit();
}
