import {
  clearModelOverride,
  getModelStatus,
  removeModelOption,
  setCurrentModel,
  upsertModelOption,
  type ModelOption,
  type ProviderType,
} from '../../model-config.js';
import type { CommandResult } from '../types.js';

type ParsedModelAdd = ModelOption & { setCurrent?: boolean };

const MODEL_USAGE = [
  '用法：',
  '- `/model` 或 `/model status`：查看当前模型',
  '- `/model list`：列出可选模型',
  '- `/model use <name>`：切换到模型/别名',
  '- `/model add <alias> --provider <openai|claude> --model <model-id> [--base-url <url>] [--api-key-env <ENV>] [--set-current]`：新增/更新自定义模型',
  '- `/model remove <alias>`：删除自定义模型',
  '- `/model reset`：恢复默认模型',
].join('\n');

export async function handleModelCommand(args: string[]): Promise<CommandResult> {
  const raw = args.join(' ').trim();
  const lowered = raw.toLowerCase();
  if (!raw || lowered === 'status') {
    return await renderModelStatus();
  }

  if (lowered === 'help') {
    return { type: 'handled', message: MODEL_USAGE };
  }

  if (lowered === 'list') {
    return await renderModelStatus({ listOnly: true });
  }

  if (lowered === 'reset' || lowered === 'default') {
    try {
      const result = await clearModelOverride();
      return {
        type: 'handled',
        message: `✅ 已恢复默认模型\nConfig: ${result.path}`,
      };
    } catch (error) {
      console.error('[model-config] failed to reset model config:', error);
      return {
        type: 'handled',
        message: '❌ 恢复默认模型失败，请检查服务日志。',
      };
    }
  }

  const [subcommand, ...rest] = args;
  switch (subcommand?.toLowerCase()) {
    case 'add':
    case 'set':
      return await handleModelAdd(rest);
    case 'remove':
    case 'rm':
    case 'delete':
      return await handleModelRemove(rest);
    case 'use':
    case 'select':
      return await handleModelUse(rest.join(' ').trim());
    default:
      return await handleModelUse(raw);
  }
}

async function handleModelAdd(args: string[]): Promise<CommandResult> {
  try {
    const parsed = parseModelAddArgs(args);
    const result = await upsertModelOption(parsed, { setCurrent: parsed.setCurrent });
    const lines = [
      `✅ 已保存自定义模型 ${parsed.name}${parsed.setCurrent ? '，并设为当前模型' : ''}`,
      `- provider: ${parsed.provider_type ?? '默认'}`,
      `- model: ${parsed.model ?? parsed.name}`,
    ];
    if (parsed.base_url) lines.push(`- base_url: ${parsed.base_url}`);
    if (parsed.api_key_env) {
      const present = process.env[parsed.api_key_env]?.trim() ? '✅' : '⚠️ 未设置';
      lines.push(`- api_key_env: ${parsed.api_key_env} ${present}`);
    }
    lines.push(`Config: ${result.path}`);
    return { type: 'handled', message: lines.join('\n') };
  } catch (error) {
    console.error('[model-config] failed to add model option:', error);
    return {
      type: 'handled',
      message: `❌ 新增自定义模型失败：${formatError(error)}\n\n${MODEL_USAGE}`,
    };
  }
}

async function handleModelRemove(args: string[]): Promise<CommandResult> {
  const name = args.join(' ').trim();
  if (!name) {
    return { type: 'handled', message: `❌ 请提供要删除的模型别名。\n\n${MODEL_USAGE}` };
  }

  try {
    const result = await removeModelOption(name);
    return {
      type: 'handled',
      message: `✅ 已删除自定义模型 ${name}\nConfig: ${result.path}`,
    };
  } catch (error) {
    console.error('[model-config] failed to remove model option:', error);
    return {
      type: 'handled',
      message: `❌ 删除自定义模型失败：${formatError(error)}`,
    };
  }
}

async function handleModelUse(model: string): Promise<CommandResult> {
  if (!model) {
    return { type: 'handled', message: MODEL_USAGE };
  }

  try {
    const result = await setCurrentModel(model);
    const option = result.config.options?.find((item) => item.name === model);
    const providerHint = option?.provider_type ? ` (${option.provider_type})` : '';
    const modelHint = option?.model ? `\nmodel: ${option.model}` : '';
    const baseURLHint = option?.base_url ? `\nbaseURL: ${option.base_url}` : '';
    const apiKeyHint = option?.api_key_env ? `\napi_key_env: ${option.api_key_env}` : '';
    return {
      type: 'handled',
      message: `✅ 已更新模型为 ${model}${providerHint}${modelHint}${baseURLHint}${apiKeyHint}\nConfig: ${result.path}`,
    };
  } catch (error) {
    console.error('[model-config] failed to update model config:', error);
    return {
      type: 'handled',
      message: `❌ 更新模型失败：${formatError(error)}`,
    };
  }
}

function parseModelAddArgs(args: string[]): ParsedModelAdd {
  const tokens = [...args];
  const alias = tokens.shift()?.trim();
  if (!alias) {
    throw new Error('缺少模型别名');
  }

  const option: ParsedModelAdd = { name: alias };
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token === '--set-current' || token === '--current' || token === '--use') {
      option.setCurrent = true;
      continue;
    }

    const keyValue = parseFlag(token);
    const key = keyValue?.key ?? token;
    const value = keyValue?.value ?? tokens[++i];
    if (!key.startsWith('--')) {
      throw new Error(`无法识别参数：${key}`);
    }
    if (!value) {
      throw new Error(`参数 ${key} 缺少值`);
    }

    switch (key) {
      case '--provider':
      case '--provider-type':
        option.provider_type = parseProviderType(value);
        break;
      case '--model':
      case '--model-id':
        option.model = value;
        break;
      case '--base-url':
      case '--baseURL':
        option.base_url = value;
        break;
      case '--api-key-env':
      case '--key-env':
        option.api_key_env = value;
        break;
      default:
        throw new Error(`不支持的参数：${key}`);
    }
  }

  return option;
}

function parseFlag(token: string): { key: string; value: string } | null {
  const index = token.indexOf('=');
  if (index <= 0) {
    return null;
  }
  return {
    key: token.slice(0, index),
    value: token.slice(index + 1),
  };
}

function parseProviderType(value: string): ProviderType {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'openai' || normalized === 'claude') {
    return normalized;
  }
  throw new Error('provider 仅支持 openai 或 claude');
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function renderModelStatus(options?: { listOnly?: boolean }): Promise<CommandResult> {
  try {
    const status = await getModelStatus();
    if (!status.path) {
      return {
        type: 'handled',
        message: 'ℹ️ 当前未找到模型配置文件。',
      };
    }

    const lines = options?.listOnly
      ? ['🧠 可选模型：', `- Config: ${status.path}`]
      : ['🧠 当前模型信息：', `- Config: ${status.path}`];
    if (!options?.listOnly) {
      if (status.currentModel) {
        const providerHint = status.providerType ? ` (${status.providerType})` : '';
        lines.push(`- current_model: ${status.currentModel}${providerHint}`);
      } else {
        lines.push('- current_model: (未设置)');
      }
      if (status.resolvedModel) {
        lines.push(`- resolved_model: ${status.resolvedModel}`);
      } else {
        lines.push('- resolved_model: (未解析到)');
      }
      if (status.resolvedBaseURL) {
        lines.push(`- base_url: ${status.resolvedBaseURL}`);
      }
      if (status.resolvedApiKeyEnv) {
        const present = process.env[status.resolvedApiKeyEnv]?.trim() ? '✅' : '⚠️ 未设置';
        lines.push(`- api_key_env: ${status.resolvedApiKeyEnv} ${present}`);
      }
    }
    if (status.options && status.options.length > 0) {
      lines.push('- options:');
      for (const opt of status.options) {
        const currentMark = status.currentModel === opt.name ? ' *' : '';
        const providerLabel = opt.provider_type ? ` [${opt.provider_type}]` : '';
        const modelHint = opt.model ? ` → ${opt.model}` : '';
        const baseHint = opt.base_url ? ` @ ${opt.base_url}` : '';
        lines.push(`  • ${opt.name}${currentMark}${providerLabel}${modelHint}${baseHint}`);
      }
    } else if (status.models && status.models.length > 0) {
      lines.push(`- models: ${status.models.join(', ')}`);
    } else if (options?.listOnly) {
      lines.push('- options: (空)');
    }
    return {
      type: 'handled',
      message: lines.join('\n'),
    };
  } catch (error) {
    console.error('[model-config] failed to read model status:', error);
    return {
      type: 'handled',
      message: '❌ 查询模型状态失败，请检查服务日志。',
    };
  }
}
