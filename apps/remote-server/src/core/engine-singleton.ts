import { Engine } from 'pulse-coder-engine';
import {
  SubAgentPlugin,
  builtInAgentTeamsPlugin,
  builtInMCPPlugin,
  builtInPlanModePlugin,
  builtInPtcPlugin,
  builtInRoleSoulPlugin,
  builtInSkillsPlugin,
  builtInTaskTrackingPlugin,
  builtInToolSearchPlugin,
} from 'pulse-coder-engine/built-in';
import { memoryIntegration } from './memory-integration.js';
import { worktreeIntegration } from './worktree/integration.js';
import { vaultIntegration } from './vault/integration.js';
import { analyzeImageTool } from './tools/analyze-image.js';
import { cronJobTool } from './tools/cron-job.js';
import { deferDemoTool } from './tools/defer-demo.js';
import { jinaAiReadTool } from './tools/jina-ai.js';
import { readLinkedSessionTool } from './tools/read-linked-session.js';
import { sessionSummaryTool } from './tools/session-summary.js';
import { twitterListTweetsTool } from './tools/twitter-list-tweets.js';
import { worktreeTools } from './tools/worktree-tools.js';
import { ptcDemoTools } from './tools/ptc-demo.js';
import { larkCliTool } from './tools/lark-cli.js';
import { devtoolsPlugin } from './devtools.js';
import { langfusePlugin } from './langfuse.js';

function isRemoteMcpEnabled(): boolean {
  const value = process.env.REMOTE_SERVER_MCP_ENABLED?.trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes' || value === 'on';
}

function buildRemoteServerBuiltInPlugins() {
  const plugins = [
    builtInSkillsPlugin,
    builtInToolSearchPlugin,
    builtInPlanModePlugin,
    builtInTaskTrackingPlugin,
    new SubAgentPlugin(),
    builtInAgentTeamsPlugin,
    builtInRoleSoulPlugin,
    builtInPtcPlugin,
  ];

  if (isRemoteMcpEnabled()) {
    return [builtInMCPPlugin, ...plugins];
  }

  console.warn('[remote-server] Built-in MCP plugin disabled; set REMOTE_SERVER_MCP_ENABLED=1 to enable it.');
  return plugins;
}

/**
 * Single Engine instance shared across all platform adapters.
 * engine.run(context, options) is stateless per-call - each invocation
 * receives its own Context object, so concurrent runs from different users are safe.
 */
export const engine = new Engine({
  disableBuiltInPlugins: true,
  enginePlugins: {
    plugins: [
      ...buildRemoteServerBuiltInPlugins(),
      memoryIntegration.enginePlugin,
      worktreeIntegration.enginePlugin,
      vaultIntegration.enginePlugin,
      devtoolsPlugin,
      langfusePlugin,
    ],
  },
  tools: {
    analyze_image: analyzeImageTool,
    cron_job: cronJobTool,
    deferred_demo: deferDemoTool,
    jina_ai_read: jinaAiReadTool,
    read_linked_session: readLinkedSessionTool,
    session_summary: sessionSummaryTool,
    twitter_list_tweets: twitterListTweetsTool,
    ...worktreeTools,
    lark_cli: larkCliTool,
    ...ptcDemoTools,
  },
});
