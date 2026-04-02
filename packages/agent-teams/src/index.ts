// Core classes
export { Team } from './team.js';
export { TeamLead } from './team-lead.js';
export type { TeamLeadOptions } from './team-lead.js';
export { Teammate } from './teammate.js';
export { Mailbox } from './mailbox.js';
export { TaskList } from './task-list.js';

// Planner
export { planTeam, buildTeammateOptionsFromPlan } from './planner.js';
export type { PlannerOptions, TeamPlan } from './planner.js';

// MCP
export { createTeamMCPServer } from './mcp-server.js';
export {
  generateMCPConfig,
  writeMCPConfigFile,
  getMCPConfigPath,
  setupMCPConfig,
  getMCPArgs,
} from './mcp-config.js';
export type { MCPConfig, MCPServerConfig } from './mcp-config.js';

// Display
export { InProcessDisplay } from './display/in-process.js';

// Types
export type {
  EngineOptions,
  TeamConfig,
  TeamStatus,
  TeamMemberInfo,
  PersistedTeamConfig,
  TeammateOptions,
  TeammateStatus,
  Task,
  CreateTaskInput,
  TaskStatus,
  TeamMessage,
  MessageType,
  TeamHooks,
  TeamEvent,
  TeamEventType,
  TeamEventHandler,
  DisplayMode,
} from './types.js';
