import { worktreeService } from './integration.js';
import {
  createOrRegisterWorktree,
  getManagedWorktree,
  normalizeWorktreeId,
} from './manager.js';

const COMMAND_PREFIX = '/wt';
const MAX_PATH_LENGTH = 400;

export interface WorktreeCommandResult {
  handled: boolean;
  message?: string;
}

interface ParsedTokens {
  command: string;
  args: string[];
}

interface UpdateBindingInput {
  runtimeKey: string;
  scopeKey: string;
  id: string;
  repoRoot: string;
  worktreePath: string;
  branch?: string;
}

export async function processWorktreeCommand(input: {
  text: string;
  runtimeKey: string;
  scopeKey: string;
}): Promise<WorktreeCommandResult> {
  const raw = input.text.trim();
  if (!raw.startsWith(COMMAND_PREFIX)) {
    return { handled: false };
  }

  const tokens = parseTokens(raw);
  if (!tokens) {
    return {
      handled: true,
      message: buildHelpMessage(),
    };
  }

  switch (tokens.command) {
    case 'help':
      return {
        handled: true,
        message: buildHelpMessage(),
      };

    case 'status': {
      const binding = await worktreeService.getScopeBinding({
        runtimeKey: input.runtimeKey,
        scopeKey: input.scopeKey,
      });

      if (!binding) {
        return {
          handled: true,
          message: [
            '🧭 当前没有绑定 worktree。',
            '使用 `/wt use <id> <repoRoot> <worktreePath> [branch]` 绑定。',
          ].join('\n'),
        };
      }

      const lines = [
        '🧭 当前 worktree 绑定：',
        `- id: ${binding.worktree.id}`,
        `- repoRoot: ${binding.worktree.repoRoot}`,
        `- worktreePath: ${binding.worktree.worktreePath}`,
      ];

      if (binding.worktree.branch) {
        lines.push(`- branch: ${binding.worktree.branch}`);
      }

      return {
        handled: true,
        message: lines.join('\n'),
      };
    }

    case 'use': {
      if (tokens.args.length === 1) {
        const rawId = tokens.args[0]?.trim() ?? '';
        if (!rawId) {
          return {
            handled: true,
            message: '❌ id 不能为空。',
          };
        }

        const normalizedId = normalizeWorktreeId(rawId);
        if (!normalizedId) {
          return {
            handled: true,
            message: '❌ id 不能为空。',
          };
        }

        const existing = await getManagedWorktree(rawId);
        if (!existing) {
          const created = await createOrRegisterWorktree({
            id: normalizedId,
            bind: {
              runtimeKey: input.runtimeKey,
              scopeKey: input.scopeKey,
            },
          });
          if (!created.ok) {
            return {
              handled: true,
              message: `❌ 创建 worktree 失败：${created.reason}`,
            };
          }

          return {
            handled: true,
            message: buildBindingMessage({ worktree: created.worktree }, created.created),
          };
        }

        if (existing.repoRoot.length > MAX_PATH_LENGTH || existing.worktreePath.length > MAX_PATH_LENGTH) {
          return {
            handled: true,
            message: '❌ 路径过长，请缩短后重试。',
          };
        }

        const binding = await worktreeService.upsertAndBind(
          {
            runtimeKey: input.runtimeKey,
            scopeKey: input.scopeKey,
          },
          {
            id: existing.id,
            repoRoot: existing.repoRoot,
            worktreePath: existing.worktreePath,
            branch: existing.branch,
          },
        );

        return {
          handled: true,
          message: buildBindingMessage(binding, false),
        };
      }

      const parseResult = parseUseArgs(tokens.args);
      if (!parseResult.ok) {
        return {
          handled: true,
          message: parseResult.reason,
        };
      }

      const binding = await worktreeService.upsertAndBind(
        {
          runtimeKey: input.runtimeKey,
          scopeKey: input.scopeKey,
        },
        {
          id: parseResult.value.id,
          repoRoot: parseResult.value.repoRoot,
          worktreePath: parseResult.value.worktreePath,
          branch: parseResult.value.branch,
        },
      );

      return {
        handled: true,
        message: buildBindingMessage(binding, false),
      };
    }

    case 'clear': {
      const result = await worktreeService.clearScopeBinding({
        runtimeKey: input.runtimeKey,
        scopeKey: input.scopeKey,
      });

      if (!result.ok) {
        return {
          handled: true,
          message: '❌ 清除绑定失败，请稍后重试。',
        };
      }

      if (!result.cleared) {
        return {
          handled: true,
          message: 'ℹ️ 当前没有 worktree 绑定。',
        };
      }

      return {
        handled: true,
        message: `🧹 已清除绑定：${result.cleared.worktreeId}`,
      };
    }

    default:
      return {
        handled: true,
        message: `⚠️ 未知子命令：${tokens.command}\n\n${buildHelpMessage()}`,
      };
  }
}

export async function updateScopeWorktreeBinding(input: UpdateBindingInput): Promise<void> {
  await worktreeService.upsertAndBind(
    {
      runtimeKey: input.runtimeKey,
      scopeKey: input.scopeKey,
    },
    {
      id: input.id,
      repoRoot: input.repoRoot,
      worktreePath: input.worktreePath,
      branch: input.branch,
    },
  );
}

function parseTokens(raw: string): ParsedTokens | null {
  const tokens = raw.split(/\s+/g).filter(Boolean);
  if (tokens.length === 0) {
    return null;
  }

  const command = tokens[1]?.trim() ?? 'help';
  return {
    command,
    args: tokens.slice(2),
  };
}

function parseUseArgs(args: string[]):
  | { ok: true; value: { id: string; repoRoot: string; worktreePath: string; branch?: string } }
  | { ok: false; reason: string } {
  if (args.length < 3) {
    return {
      ok: false,
      reason: '❌ 参数不足\n用法：/wt use <id> <repoRoot> <worktreePath> [branch]',
    };
  }

  const id = args[0]?.trim() ?? '';
  const repoRoot = args[1]?.trim() ?? '';
  const worktreePath = args[2]?.trim() ?? '';
  const branch = args[3]?.trim();

  if (!id || !repoRoot || !worktreePath) {
    return {
      ok: false,
      reason: '❌ id/repoRoot/worktreePath 不能为空。',
    };
  }

  if (repoRoot.length > MAX_PATH_LENGTH || worktreePath.length > MAX_PATH_LENGTH) {
    return {
      ok: false,
      reason: '❌ 路径过长，请缩短后重试。',
    };
  }

  return {
    ok: true,
    value: {
      id,
      repoRoot,
      worktreePath,
      branch,
    },
  };
}

function buildHelpMessage(): string {
  return [
    '🧩 Worktree 命令：',
    '/wt status - 查看当前会话绑定的 worktree',
    '/wt use <id> - 复用已有或创建新的 worktree 并绑定',
    '/wt use <id> <repoRoot> <worktreePath> [branch] - 绑定/更新当前会话 worktree',
    '/wt clear - 清除当前会话 worktree 绑定',
  ].join('\n');
}

function buildBindingMessage(
  binding: { worktree: { id: string; repoRoot: string; worktreePath: string; branch?: string } },
  created: boolean,
): string {
  const lines = [created ? '✅ 已创建并绑定 worktree。' : '✅ 已更新 worktree 绑定。'];
  lines.push(`- id: ${binding.worktree.id}`);
  lines.push(`- repoRoot: ${binding.worktree.repoRoot}`);
  lines.push(`- worktreePath: ${binding.worktree.worktreePath}`);
  if (binding.worktree.branch) {
    lines.push(`- branch: ${binding.worktree.branch}`);
  }
  return lines.join('\n');
}
