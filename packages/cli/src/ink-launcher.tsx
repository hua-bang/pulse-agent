import React from 'react';
import { render } from 'ink';

import { InkCliApp, type InkCliEvent, type InkCliSnapshot } from './ink-app.js';

export interface InkTuiOptions {
  snapshot?: Partial<InkCliSnapshot>;
  events?: InkCliEvent[];
}

export async function startInkTui(options: InkTuiOptions = {}): Promise<void> {
  const instance = render(
    <InkCliApp
      initialSnapshot={{
        ...options.snapshot,
        events: options.events ?? options.snapshot?.events,
      }}
    />,
  );

  await instance.waitUntilExit();
}
