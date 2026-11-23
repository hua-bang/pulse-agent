import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { SshRunner } from './ssh-bootstrap';

export interface SyncRemoteToolingOptions {
  sshHost: string;
  sshPort: number;
  remoteDir: string;
  dataDir: string;
  run: SshRunner;
  /** Override path to canvas-cli/index.cjs (for tests). */
  cliBundlePath?: string;
  /** Override path to skills/canvas/SKILL.md (for tests). */
  skillDocPath?: string;
}

function resolveBundledCanvasCliPaths(): {
  cliBundlePath: string;
  skillDocPath: string | null;
} | null {
  const dirs: string[] = [];
  if (typeof process.resourcesPath === 'string' && process.resourcesPath) {
    dirs.push(join(process.resourcesPath, 'agent-tooling', 'canvas-cli'));
  }
  dirs.push(
    resolve(__dirname, '..', '..', '..', '..', '..', 'packages', 'canvas-cli', 'dist'),
    resolve(process.cwd(), 'packages', 'canvas-cli', 'dist'),
    resolve(process.cwd(), '..', '..', 'packages', 'canvas-cli', 'dist'),
  );
  for (const dir of dirs) {
    const cliPath = join(dir, 'index.cjs');
    if (!existsSync(cliPath)) continue;
    const skillCandidates = [
      join(dir, 'skills', 'canvas', 'SKILL.md'),
      resolve(dir, '..', 'skills', 'canvas', 'SKILL.md'),
    ];
    const skillDocPath = skillCandidates.find((p) => existsSync(p)) ?? null;
    return { cliBundlePath: cliPath, skillDocPath };
  }
  return null;
}

/**
 * Push bundled `canvas-cli` (`pulse-canvas`) and its `pulse-canvas` skill to the
 * VPS so Codex CLI / Claude Code running on the VPS can list, read, and mutate
 * canvas nodes directly against the VPS SQLite store.
 */
export async function syncRemoteCanvasTooling(options: SyncRemoteToolingOptions): Promise<boolean> {
  const resolved = options.cliBundlePath
    ? { cliBundlePath: options.cliBundlePath, skillDocPath: options.skillDocPath ?? null }
    : resolveBundledCanvasCliPaths();
  if (!resolved) return false;

  const cliBytes = readFileSync(resolved.cliBundlePath);
  const rawSkill =
    resolved.skillDocPath && existsSync(resolved.skillDocPath)
      ? readFileSync(resolved.skillDocPath, 'utf8').replace(/^name:.*$/m, 'name: pulse-canvas')
      : null;

  const hash = createHash('sha256')
    .update('wrapper-v2:')
    .update(cliBytes)
    .update(rawSkill ?? '')
    .digest('hex')
    .slice(0, 16);

  const probeScript = [
    `HASH=$(cat "${options.remoteDir}/canvas-cli.sha" 2>/dev/null || true)`,
    `BIN=$(test -x "${options.remoteDir}/bin/pulse-canvas" && echo ok || echo missing)`,
    'printf "%s\\n%s\\n" "$HASH" "$BIN"',
    '',
  ].join('\n');

  const probeRes = await options.run({
    sshHost: options.sshHost,
    sshPort: options.sshPort,
    remoteCommand: 'sh -s',
    stdin: probeScript,
  });
  if (probeRes.code === 0) {
    const [remoteHash = '', binState = 'missing'] = probeRes.stdout.trim().split(/\r?\n/);
    if (remoteHash.trim() === hash && binState.trim() === 'ok') {
      return false;
    }
  }

  const uploadRes = await options.run({
    sshHost: options.sshHost,
    sshPort: options.sshPort,
    remoteCommand: `mkdir -p "${options.remoteDir}/canvas-cli" "${options.remoteDir}/bin" && cat > "${options.remoteDir}/canvas-cli/index.cjs.tmp" && mv "${options.remoteDir}/canvas-cli/index.cjs.tmp" "${options.remoteDir}/canvas-cli/index.cjs"`,
    stdin: cliBytes,
  });
  if (uploadRes.code !== 0) return false;

  const skillBase64 = rawSkill ? Buffer.from(rawSkill, 'utf8').toString('base64') : '';
  const installScript = [
    'set -e',
    'NODE_BIN="$(command -v node)"',
    `mkdir -p "${options.remoteDir}/bin"`,
    `cat > "${options.remoteDir}/bin/pulse-canvas" << PULSE_WRAPPER_EOF`,
    '#!/bin/sh',
    `export NODE_PATH="${options.remoteDir}/node_modules\\\${NODE_PATH:+:\\\$NODE_PATH}"`,
    `export PULSE_CANVAS_DATA_DIR="\\\${PULSE_CANVAS_DATA_DIR:-${options.dataDir}}"`,
    `exec "\${NODE_BIN}" "${options.remoteDir}/canvas-cli/index.cjs" "\\$@"`,
    'PULSE_WRAPPER_EOF',
    `chmod +x "${options.remoteDir}/bin/pulse-canvas"`,
    `ln -sf "${options.remoteDir}/bin/pulse-canvas" "${options.remoteDir}/bin/canvas-cli"`,
    ...(skillBase64
      ? [
          'for SKILL_ROOT in "$HOME/.codex/skills" "$HOME/.claude/skills" "$HOME/.agents/skills"; do',
          '  mkdir -p "$SKILL_ROOT/pulse-canvas"',
          `  node -e "process.stdout.write(Buffer.from('${skillBase64}','base64'))" > "$SKILL_ROOT/pulse-canvas/SKILL.md"`,
          'done',
        ]
      : []),
    `printf "%s" "${hash}" > "${options.remoteDir}/canvas-cli.sha"`,
    '',
  ].join('\n');

  const installRes = await options.run({
    sshHost: options.sshHost,
    sshPort: options.sshPort,
    remoteCommand: 'sh -s',
    stdin: installScript,
  });
  return installRes.code === 0;
}
