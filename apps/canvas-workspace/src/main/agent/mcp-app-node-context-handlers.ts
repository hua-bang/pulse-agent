import type { IpcMainInvokeEvent } from 'electron';
import { loadCanvas } from '../canvas/service';
import { parseMcpAppNodeBinding, MCP_APP_NODE_PLUGIN_ID, MCP_APP_NODE_TYPE } from '../../shared/mcp-app-node';
import type { McpAppContextSource, McpAppNodeContextTarget } from '../../shared/mcp-apps';
import { getMcpAppNodeContextStore } from './mcp-app-node-context';

export function createMcpAppNodeContextHandlers() {
  const store = getMcpAppNodeContextStore();
  const senders = new Set<number>();
  const opening = new Map<string, symbol>();
  const open = async (event: IpcMainInvokeEvent, target: McpAppNodeContextTarget) => {
    let key: string | undefined;
    const request = Symbol();
    try {
      if (!target || !['workspaceId', 'nodeId', 'serverName', 'toolName', 'resourceUri'].every(key => {
        const value = target[key as keyof McpAppNodeContextTarget];
        return typeof value === 'string' && value.length > 0 && value.length <= 4_096;
      })) throw new Error('Invalid MCP App context target');
      key = JSON.stringify([target.workspaceId, target.nodeId]);
      opening.set(key, request);
      const canvas = await loadCanvas(target.workspaceId);
      if (opening.get(key) !== request) throw new Error('MCP App context mount was replaced');
      const node = canvas?.nodes?.find(value => value.id === target.nodeId);
      if (canvas && !node) {
        return { ok: false, code: 'node-not-persisted', error: 'MCP App node is not saved yet' };
      }
      const data = node?.data as Record<string, unknown> | undefined;
      const binding = parseMcpAppNodeBinding(data?.payload);
      if (node?.type !== 'plugin' || data?.pluginId !== MCP_APP_NODE_PLUGIN_ID
        || data?.nodeType !== MCP_APP_NODE_TYPE || !binding
        || binding.serverName !== target.serverName || binding.toolName !== target.toolName
        || binding.resourceUri !== target.resourceUri) {
        throw new Error('MCP App context target does not match the canvas node');
      }
      if (event.sender.isDestroyed()) throw new Error('MCP App renderer is closed');
      const senderId = event.sender.id;
      if (!senders.has(senderId)) {
        senders.add(senderId);
        event.sender.once('destroyed', () => {
          senders.delete(senderId);
          store.clearSender(senderId);
        });
      }
      return { ok: true, token: store.open(senderId, target) };
    } catch (error) {
      return { ok: false, error: String(error) };
    } finally {
      if (key && opening.get(key) === request) opening.delete(key);
    }
  };
  const update = (event: IpcMainInvokeEvent, payload: {
    token: string; source: McpAppContextSource; context: unknown;
  }) => {
    try {
      store.update(event.sender.id, payload?.token, payload?.source, payload?.context);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  };
  const close = (event: IpcMainInvokeEvent, payload: { token: string }) => {
    store.close(event.sender.id, payload?.token);
    return { ok: true };
  };
  return { open, update, close };
}
