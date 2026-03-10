import type { EnginePlugin, EnginePluginContext } from '../../plugin/EnginePlugin';

import { AcpHttpClient } from './client';
import { ACP_SERVICE_NAME, buildClientConfigFromEnv, DEFAULT_SESSION_STORE_PATH, DEFAULT_TARGET } from './config';
import { FileAcpSessionStore } from './session-store';
import { AcpBridgeService } from './service';
import { createAcpTools } from './tools';

export const builtInAcpPlugin: EnginePlugin = {
  name: 'pulse-coder-engine/built-in-acp',
  version: '0.1.0',
  async initialize(context: EnginePluginContext) {
    const client = new AcpHttpClient(buildClientConfigFromEnv(process.env));
    const storePath = process.env.ACP_SESSION_STORE_PATH?.trim() || DEFAULT_SESSION_STORE_PATH;
    const sessionStore = new FileAcpSessionStore(storePath);
    const defaultTarget = process.env.ACP_DEFAULT_TARGET?.trim() || DEFAULT_TARGET;
    const service = new AcpBridgeService({
      client,
      sessionStore,
      defaultTarget,
    });

    await sessionStore.initialize();

    context.registerService(ACP_SERVICE_NAME, service);

    const tools = createAcpTools(service);
    for (const [toolName, tool] of Object.entries(tools)) {
      context.registerTool(toolName, tool);
    }

    const status = service.getStatus();
    context.logger.info(
      `[ACP] plugin ready configured=${status.configured} baseUrl=${status.baseUrl ?? '(unset)'} defaultTarget=${status.defaultTarget}`,
    );
  },
};

export default builtInAcpPlugin;
