/**
 * Startup-light entry for global MCP Apps: the Sidebar and App shell load
 * this eagerly, while the app host (`GlobalMcpAppsView`, which pulls in
 * `McpAppFrame`) stays behind the lazy root barrel. Measured: importing the
 * root barrel from the shell added ~35 KB to the renderer entry chunk.
 */
export { GlobalMcpAppTile } from './components/GlobalMcpApps/GlobalMcpAppTile';
export { useGlobalMcpApps } from './components/GlobalMcpApps/useGlobalMcpApps';
export {
  globalMcpAppKey,
  globalMcpAppsStore,
  type GlobalMcpAppTarget,
} from './components/GlobalMcpApps/globalMcpAppsStore';
