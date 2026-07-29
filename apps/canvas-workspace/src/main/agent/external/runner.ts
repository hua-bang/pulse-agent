/**
 * Family dispatch + health probe for external role drivers. Segment
 * orchestration (session continuity, prompt rendering, retry) lives in
 * segment.ts; this module only knows which adapter serves which family.
 */

import { spawn } from 'child_process';
import type { AgentRoleExternalFamily } from '../../../shared/agent-roles';
import { claudeCodeCommand, runClaudeCodeSegment } from './claude-code';
import { codexCommand, runCodexSegment } from './codex';
import type { ExternalSegmentRequest, ExternalSegmentResult } from './types';

export function externalCliCommand(family: AgentRoleExternalFamily): string {
  return family === 'claude-code' ? claudeCodeCommand() : codexCommand();
}

export async function runExternalSegment(request: ExternalSegmentRequest): Promise<ExternalSegmentResult> {
  return request.family === 'claude-code' ? runClaudeCodeSegment(request) : runCodexSegment(request);
}

/** `<cli> --version` with a short timeout; ok → first stdout line. */
export async function probeExternalCli(family: AgentRoleExternalFamily): Promise<{ version: string }> {
  const command = externalCliCommand(family);
  return await new Promise((resolve, reject) => {
    const child = spawn(command, ['--version'], { stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
    let out = '';
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      settle(() => reject(new Error(`"${command} --version" timed out`)));
    }, 5000);
    timer.unref();
    child.on('error', (err) => settle(() => reject(new Error(`"${command}" not found: ${err.message}`))));
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { out += chunk; });
    child.on('close', (code) => {
      const version = out.trim().split('\n')[0] ?? '';
      if (code === 0 && version) settle(() => resolve({ version }));
      else settle(() => reject(new Error(`"${command} --version" exited with code ${code}`)));
    });
  });
}
