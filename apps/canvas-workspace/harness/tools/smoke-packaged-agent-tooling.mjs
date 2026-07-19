import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';

const defaultApp = join(
  process.cwd(),
  'apps/canvas-workspace/release/mac-arm64/Pulse Canvas.app',
);
const requestedApp = process.argv[2] ?? defaultApp;
const appPath = isAbsolute(requestedApp) ? requestedApp : resolve(requestedApp);
const executable = join(appPath, 'Contents/MacOS/Pulse Canvas');
const resources = join(appPath, 'Contents/Resources/agent-tooling/canvas-cli');
const home = await fs.mkdtemp(join(tmpdir(), 'pulse-packaged-tooling-'));
const env = {
  ...process.env,
  HOME: home,
  PATH: '/usr/bin:/bin',
};
let child;

try {
  await fs.access(executable);
  const sourceSkills = (await fs.readdir(join(resources, 'skills'), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name === 'canvas' ? 'pulse-canvas' : entry.name)
    .sort();

  child = spawn(executable, [], { env, stdio: 'ignore' });
  const wrapper = join(home, '.pulse-coder/bin/pulse-canvas');
  const activeState = join(home, '.pulse-coder/tooling/pulse-canvas/active.json');
  await waitFor(wrapper, 30_000);
  await waitFor(activeState, 30_000);

  const version = await run(wrapper, ['--version'], env);
  if (!version.trim()) throw new Error('Bundled CLI returned an empty version');
  const active = JSON.parse(await fs.readFile(activeState, 'utf8'));
  if (active.version !== version.trim()) {
    throw new Error(`Active tooling state does not match CLI version: ${JSON.stringify(active)}`);
  }
  const status = JSON.parse(await run(wrapper, ['--format', 'json', 'status'], env));
  if (status.runtime?.reachable !== true) {
    throw new Error(`Bundled CLI could not reach the packaged app: ${JSON.stringify(status)}`);
  }

  const parents = [
    join(home, '.pulse-coder/skills'),
    join(home, '.codex/skills'),
    join(home, '.claude/skills'),
  ];
  for (const parent of parents) {
    for (const skill of sourceSkills) {
      await fs.access(join(parent, skill, 'SKILL.md'));
    }
  }

  console.log(
    `packaged agent tooling smoke passed: pulse-canvas ${version.trim()}, `
      + `${sourceSkills.length} skills × ${parents.length} agent homes`,
  );
} finally {
  if (child && child.exitCode === null) {
    child.kill('SIGTERM');
    await Promise.race([
      new Promise((resolveExit) => child.once('exit', resolveExit)),
      new Promise((resolveTimeout) => setTimeout(resolveTimeout, 2_000)),
    ]);
    if (child.exitCode === null) child.kill('SIGKILL');
  }
  await fs.rm(home, { recursive: true, force: true });
}

async function waitFor(path, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await fs.access(path);
      return;
    } catch {
      await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    }
  }
  throw new Error(`Timed out waiting for ${path}`);
}

function run(command, args, commandEnv) {
  return new Promise((resolveRun, rejectRun) => {
    const process = spawn(command, args, { env: commandEnv, stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout = [];
    const stderr = [];
    process.stdout.on('data', (chunk) => stdout.push(chunk));
    process.stderr.on('data', (chunk) => stderr.push(chunk));
    process.once('error', rejectRun);
    process.once('exit', (code) => {
      if (code === 0) resolveRun(Buffer.concat(stdout).toString('utf8'));
      else rejectRun(new Error(
        `${command} exited ${code}: ${Buffer.concat(stderr).toString('utf8')}`,
      ));
    });
  });
}
