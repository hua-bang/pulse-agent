import z from 'zod';
import type { Tool } from 'pulse-coder-engine';
import { createOrRegisterWorktree, getManagedWorktree, normalizeWorktreeId } from '../worktree/manager.js';
import { buildRemoteWorktreeRunContext, worktreeService } from '../worktree/integration.js';
import { runWorktreeCommand, type WorktreeRunBackend } from '../worktree/runner.js';

const prepareSchema = z.object({
  id: z
    .string()
    .optional()
    .describe('Optional worktree id. If omitted, a stable id is derived from the current channel/session.'),
  branch: z.string().optional().describe('Optional branch name. Defaults to feat/<id>.'),
  baseRef: z.string().optional().describe('Optional base ref for new worktrees, such as origin/main.'),
  repoRoot: z.string().optional().describe('Optional source repository root. Defaults to PULSE_CODER_REPO_ROOT or current git root.'),
  worktreePath: z.string().optional().describe('Optional explicit worktree path. Defaults to ~/.pulse-coder/worktrees/<project>/wt-<id>.'),
});

const runSchema = z.object({
  id: z.string().optional().describe('Optional worktree id. If omitted, uses the current channel binding.'),
  backend: z.enum(['host', 'docker']).default('host').describe('Execution backend. Use host for trusted lightweight validation; use docker for risky or clean-environment validation.'),
  command: z.string().optional().describe('Executable to run. Prefer shell for compound commands.'),
  args: z.array(z.string()).optional().describe('Arguments for command.'),
  shell: z.string().optional().describe('Shell command to run in the worktree, e.g. pnpm run build && pnpm test.'),
  timeoutMs: z.number().int().positive().max(60 * 60 * 1000).optional().describe('Timeout in milliseconds. Defaults to 10 minutes.'),
  env: z.record(z.string(), z.string()).optional().describe('Extra env vars for host backend.'),
  docker: z
    .object({
      image: z.string().optional().describe('Docker image. Defaults to PULSE_CODER_DOCKER_IMAGE or node:22-bookworm.'),
      user: z.string().optional().describe('Docker user, e.g. 1000:1000. Defaults to current uid:gid.'),
      network: z.string().optional().describe('Docker network mode, e.g. none or host.'),
      env: z.record(z.string(), z.string()).optional().describe('Extra env vars passed to docker container.'),
      extraArgs: z.array(z.string()).optional().describe('Extra docker run args, such as cache volume mounts.'),
    })
    .optional(),
});

type PrepareInput = z.infer<typeof prepareSchema>;
type RunInput = z.infer<typeof runSchema>;

interface PrepareResult {
  ok: boolean;
  created: boolean;
  id: string;
  scope: {
    runtimeKey: string;
    scopeKey: string;
  };
  worktree: {
    id: string;
    repoRoot: string;
    worktreePath: string;
    branch?: string;
  };
  message: string;
}

export const worktreePrepareTool: Tool<PrepareInput, PrepareResult> = {
  name: 'worktree_prepare',
  description: 'Create or bind an isolated git worktree for the current conversation before modifying code.',
  inputSchema: prepareSchema,
  execute: async (input, context) => {
    const scope = resolveCurrentScope(context?.runContext);
    const id = normalizeWorktreeId(input.id ?? buildDefaultWorktreeId(scope.scopeKey));
    if (!id) {
      throw new Error('Unable to resolve worktree id');
    }

    const result = await createOrRegisterWorktree({
      id,
      repoRoot: input.repoRoot,
      worktreePath: input.worktreePath,
      branch: input.branch,
      baseRef: input.baseRef,
      bind: scope,
    });

    if (!result.ok) {
      throw new Error(result.reason);
    }

    return {
      ok: true,
      created: result.created,
      id,
      scope,
      worktree: result.worktree,
      message: result.created
        ? `Created and bound worktree ${id} at ${result.worktree.worktreePath}`
        : `Using existing worktree ${id} at ${result.worktree.worktreePath}`,
    };
  },
};

export const worktreeRunTool: Tool<RunInput, Awaited<ReturnType<typeof runWorktreeCommand>>> = {
  name: 'worktree_run',
  description: 'Run validation commands inside the current managed worktree, using host execution by default and Docker when stronger isolation is needed.',
  inputSchema: runSchema,
  execute: async (input, context) => {
    const scope = resolveCurrentScope(context?.runContext);
    const worktree = input.id
      ? await getManagedWorktree(input.id)
      : (await worktreeService.getScopeBinding(scope))?.worktree;

    if (!worktree) {
      throw new Error('No worktree is bound. Call worktree_prepare first.');
    }

    const backend: WorktreeRunBackend = input.backend ?? 'host';
    return runWorktreeCommand(worktree, {
      ...input,
      backend,
    });
  },
};

export const worktreeTools = {
  worktree_prepare: worktreePrepareTool,
  worktree_run: worktreeRunTool,
};

function resolveCurrentScope(runContext: unknown): { runtimeKey: string; scopeKey: string } {
  const context = runContext && typeof runContext === 'object' ? runContext as Record<string, unknown> : {};
  const platformKey = typeof context.platformKey === 'string' ? context.platformKey : '';
  if (!platformKey) {
    throw new Error('worktree tools require runContext.platformKey');
  }
  return buildRemoteWorktreeRunContext(platformKey);
}

function buildDefaultWorktreeId(scopeKey: string): string {
  const channelPart = normalizeWorktreeId(scopeKey) || 'conversation';
  return `auto-${channelPart}`;
}
