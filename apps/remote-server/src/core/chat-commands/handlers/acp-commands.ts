import type { CommandResult } from '../types.js';
import { getAcpService } from '../services.js';

const ACP_TARGET_PATTERN = /(?:^|\s)(?:--?target|target)\s*[:=]\s*([^\s]+)/i;
const ACP_FORCE_NEW_PATTERN = /(?:^|\s)(?:--new|--fresh|new=true|fresh=true|new=1|fresh=1)\b/i;

const ACP_FLAG_TOKENS = /(?:^|\s)--(target|new|fresh)(?=\s|$)/gi;

interface ParsedAcpInput {
  prompt: string;
  target?: string;
  forceNewSession?: boolean;
}

function parseAcpInput(args: string[]): ParsedAcpInput {
  const raw = args.join(' ').trim();
  if (!raw) {
    return { prompt: '' };
  }

  const targetMatch = raw.match(ACP_TARGET_PATTERN);
  const target = targetMatch?.[1];
  const forceNewSession = ACP_FORCE_NEW_PATTERN.test(raw) || ACP_FLAG_TOKENS.test(raw);

  const cleaned = raw
    .replace(ACP_TARGET_PATTERN, ' ')
    .replace(ACP_FORCE_NEW_PATTERN, ' ')
    .replace(ACP_FLAG_TOKENS, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return {
    prompt: cleaned,
    target: target?.trim() || undefined,
    forceNewSession: forceNewSession || undefined,
  };
}

export function handleAcpCommand(args: string[]): CommandResult {
  const service = getAcpService();
  if (!service) {
    return {
      type: 'handled',
      message: 'ACP is not enabled. Confirm the ACP plugin is registered.',
    };
  }

  const parsed = parseAcpInput(args);
  if (!parsed.prompt) {
    return {
      type: 'handled',
      message: [
        'Missing prompt.',
        'Usage: /acp <prompt> [target=codex] [--new]',
      ].join('\n'),
    };
  }

  const status = service.getStatus();
  if (!status.configured) {
    return {
      type: 'handled',
      message: 'ACP bridge is not configured. Set ACP_* env vars first.',
    };
  }

  const directives = [
    'Use acp_prompt with',
    `prompt=${parsed.prompt}`,
  ];

  if (parsed.target) {
    directives.push(`target=${parsed.target}`);
  }

  if (parsed.forceNewSession) {
    directives.push('forceNewSession=true');
  }

  return {
    type: 'transformed',
    text: directives.join(' '),
  };
}
