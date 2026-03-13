export { Engine } from './Engine.js';
export { Engine as PulseAgent } from './Engine.js';

// Plugin system exports
export type {
  EnginePlugin,
  EnginePluginContext,
  EngineHookMap,
  EngineHookName,
  BeforeRunInput,
  BeforeRunResult,
  BeforeLLMCallInput,
  BeforeLLMCallResult,
  AfterRunInput,
  AfterLLMCallInput,
  BeforeToolCallInput,
  BeforeToolCallResult,
  AfterToolCallInput,
  AfterToolCallResult,
  OnCompactedEvent,
  OnCompactedInput,
} from './plugin/EnginePlugin.js';
export type { UserConfigPlugin, UserConfigPluginLoadOptions } from './plugin/UserConfigPlugin.js';
export { PluginManager } from './plugin/PluginManager.js';

// Built-in plugin exports
export {
  builtInPlugins,
  builtInAcpPlugin,
  createAcpPlugin,
  builtInMCPPlugin,
  builtInSkillsPlugin,
  builtInPlanModePlugin,
  builtInTaskTrackingPlugin,
  builtInAgentTeamsPlugin,
  builtInRoleSoulPlugin,
  builtInPtcPlugin,
  BuiltInSkillRegistry,
  BuiltInPlanModeService,
  TaskListService,
} from './built-in/index.js';
export type {
  PlanMode,
  PlanIntentLabel,
  ToolCategory,
  ToolRisk,
  ToolMeta,
  ModePolicy,
  PlanModeEvent,
  PlanModeEventName,
  PlanModeTransitionResult,
  PlanModeService,
  TaskStatus,
  WorkTask,
  WorkTaskListSnapshot,
  TeamRole,
  TaskGraph,
  TaskNode,
  NodeResult,
  TeamRunInput,
  TeamRunOutput
} from './built-in/index.js';

// Existing exports
export * from './shared/types.js';
export { loop } from './core/loop.js';
export type { LoopOptions, LoopHooks, CompactionEvent } from './core/loop.js';
export { streamTextAI } from './ai/index.js';
export { maybeCompactContext } from './context/index.js';
export * from './tools/index.js';
