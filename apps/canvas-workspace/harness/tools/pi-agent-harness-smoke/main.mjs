import { app } from 'electron';
import { AgentHarness, InMemorySessionRepo } from '@earendil-works/pi-agent-core';
import { createModels, fauxAssistantMessage, fauxProvider } from '@earendil-works/pi-ai';

const timeout = setTimeout(() => {
  process.stderr.write('Electron pi AgentHarness smoke timed out\n');
  app.exit(1);
}, 10_000);

app.whenReady().then(async () => {
  try {
    const faux = fauxProvider({ tokensPerSecond: 10_000 });
    faux.setResponses([fauxAssistantMessage('ELECTRON_PI_OK')]);
    const models = createModels();
    models.setProvider(faux.provider);
    const repo = new InMemorySessionRepo();
    const session = await repo.create({ id: 'electron-pi-smoke' });
    const harness = new AgentHarness({
      session,
      models,
      model: faux.getModel(),
      systemPrompt: 'Electron smoke test',
    });
    const response = await harness.prompt('respond');
    const text = response.content
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join('');
    process.stdout.write(`${JSON.stringify({
      electron: process.versions.electron,
      node: process.versions.node,
      text,
    })}\n`);
    clearTimeout(timeout);
    app.exit(text === 'ELECTRON_PI_OK' ? 0 : 1);
  } catch (error) {
    process.stderr.write(`${error?.stack ?? error}\n`);
    clearTimeout(timeout);
    app.exit(1);
  }
});
