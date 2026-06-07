/**
 * Loopback HTTP server used by the `pulse-canvas` CLI (and other local
 * agents) to deliver follow-up input to running agent nodes.
 *
 * The agent PTY sessions live in this main process's memory; external
 * processes can't reach them through `canvas.json`. This server exposes
 * narrow endpoints — currently `POST /agent/send` and team-control routes —
 * bound to 127.0.0.1
 * and guarded by a per-run bearer secret written to a runtime file in
 * `~/.pulse-coder/canvas-runtime/`.
 *
 * Threat model: same-user local processes can read the runtime file and
 * call the endpoint. That's identical to the trust boundary the rest of
 * the local dev tools assume (PTY, canvas.json, etc.). The server does
 * NOT execute arbitrary commands — only typed agent input — and rejects
 * anything that isn't a valid running agent node.
 */

import { app } from 'electron';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http';
import { promises as fs } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { randomBytes } from 'crypto';
import { sendInputToAgentNode } from '../agent/session-send';
import { getCanvasAgentTeamsService } from '../agent-teams/service';

const RUNTIME_DIR = join(homedir(), '.pulse-coder', 'canvas-runtime');
const RUNTIME_FILE = join(RUNTIME_DIR, 'canvas-workspace.json');
const MAX_BODY_BYTES = 64 * 1024;

interface RuntimeInfo {
  pid: number;
  baseUrl: string;
  secret: string;
  createdAt: string;
}

let serverInstance: Server | null = null;
let runtimeFilePath: string | null = null;

export interface RuntimeControlHandle {
  baseUrl: string;
  stop: () => Promise<void>;
}

/**
 * Start the loopback runtime-control server.
 *
 * Idempotent within a process: a second call returns the existing handle
 * instead of starting a second server. Cross-process duplication is
 * handled by overwriting the runtime file — the last app to start wins,
 * which is good enough for "open the same workspace twice".
 */
export async function startRuntimeControlServer(): Promise<RuntimeControlHandle> {
  if (serverInstance) {
    const addr = serverInstance.address();
    if (addr && typeof addr === 'object') {
      return {
        baseUrl: `http://127.0.0.1:${addr.port}`,
        stop: stopRuntimeControlServer,
      };
    }
  }

  await cleanupStaleRuntimeFile();

  const secret = randomBytes(32).toString('hex');
  const server = createServer((req, res) => {
    void handleRequest(req, res, secret);
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (err: Error) => reject(err);
    server.once('error', onError);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', onError);
      resolve();
    });
  });

  const addr = server.address();
  if (!addr || typeof addr !== 'object') {
    server.close();
    throw new Error('runtime-control-server: failed to bind loopback port');
  }
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  const runtime: RuntimeInfo = {
    pid: process.pid,
    baseUrl,
    secret,
    createdAt: new Date().toISOString(),
  };

  await fs.mkdir(RUNTIME_DIR, { recursive: true });
  // 0o600 — readable only by the current user. Matches the trust model.
  await fs.writeFile(RUNTIME_FILE, JSON.stringify(runtime, null, 2), { mode: 0o600 });

  serverInstance = server;
  runtimeFilePath = RUNTIME_FILE;

  // Best-effort cleanup on app quit so the next launch sees a clean slate.
  app.once('will-quit', () => {
    void stopRuntimeControlServer();
  });

  return { baseUrl, stop: stopRuntimeControlServer };
}

export async function stopRuntimeControlServer(): Promise<void> {
  const server = serverInstance;
  serverInstance = null;
  if (server) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  const file = runtimeFilePath;
  runtimeFilePath = null;
  if (file) {
    try {
      await fs.unlink(file);
    } catch {
      // ignore — file may already be gone
    }
  }
}

/**
 * If a runtime file from a prior launch exists, delete it iff the PID
 * inside is no longer alive. Leaving a stale file would point the CLI
 * at a dead port until we overwrote it ourselves.
 */
async function cleanupStaleRuntimeFile(): Promise<void> {
  let raw: string;
  try {
    raw = await fs.readFile(RUNTIME_FILE, 'utf-8');
  } catch {
    return;
  }
  let info: RuntimeInfo;
  try {
    info = JSON.parse(raw) as RuntimeInfo;
  } catch {
    await fs.unlink(RUNTIME_FILE).catch(() => {});
    return;
  }
  if (!info.pid || !isProcessAlive(info.pid)) {
    await fs.unlink(RUNTIME_FILE).catch(() => {});
  }
  // If alive, we'll overwrite it below — last-app-wins.
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  secret: string,
): Promise<void> {
  if (req.method !== 'POST') {
    return reply(res, 405, { ok: false, error: 'method not allowed' });
  }
  const auth = req.headers['authorization'];
  if (typeof auth !== 'string' || auth !== `Bearer ${secret}`) {
    return reply(res, 401, { ok: false, error: 'unauthorized' });
  }

  let body: Buffer;
  try {
    body = await readBody(req, MAX_BODY_BYTES);
  } catch (err) {
    return reply(res, 413, { ok: false, error: (err as Error).message });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body.toString('utf-8'));
  } catch {
    return reply(res, 400, { ok: false, error: 'invalid JSON body' });
  }

  if (!parsed || typeof parsed !== 'object') {
    return reply(res, 400, { ok: false, error: 'body must be a JSON object' });
  }

  if (req.url === '/agent/send') {
    return handleAgentSend(res, parsed as Record<string, unknown>);
  }
  if (req.url === '/agent-team/propose-plan') {
    return handleAgentTeamProposePlan(res, parsed as Record<string, unknown>);
  }
  if (req.url === '/agent-team/create-task') {
    return handleAgentTeamCreateTask(res, parsed as Record<string, unknown>);
  }
  if (req.url === '/agent-team/complete-task') {
    return handleAgentTeamCompleteTask(res, parsed as Record<string, unknown>);
  }
  if (req.url === '/agent-team/block-task') {
    return handleAgentTeamBlockTask(res, parsed as Record<string, unknown>);
  }
  if (req.url === '/agent-team/request-human-input') {
    return handleAgentTeamRequestHumanInput(res, parsed as Record<string, unknown>);
  }
  if (req.url === '/agent-team/publish-artifact') {
    return handleAgentTeamPublishArtifact(res, parsed as Record<string, unknown>);
  }
  if (req.url === '/agent-team/complete-team') {
    return handleAgentTeamCompleteTeam(res, parsed as Record<string, unknown>);
  }
  if (req.url === '/agent-team/dispatch') {
    return handleAgentTeamDispatch(res, parsed as Record<string, unknown>);
  }
  if (req.url === '/agent-team/send') {
    return handleAgentTeamSend(res, parsed as Record<string, unknown>);
  }

  return reply(res, 404, { ok: false, error: 'not found' });
}

function readTeamTaskAction(obj: Record<string, unknown>): {
  workspaceId: string;
  teamId: string;
  taskId?: string;
  sourceAgentId?: string;
} {
  return {
    workspaceId: typeof obj.workspaceId === 'string' ? obj.workspaceId : '',
    teamId: typeof obj.teamId === 'string' ? obj.teamId : '',
    taskId: typeof obj.taskId === 'string' ? obj.taskId : undefined,
    sourceAgentId: typeof obj.sourceAgentId === 'string' ? obj.sourceAgentId : undefined,
  };
}

async function handleAgentSend(
  res: ServerResponse,
  obj: Record<string, unknown>,
): Promise<void> {
  const workspaceId = typeof obj.workspaceId === 'string' ? obj.workspaceId : '';
  const nodeId = typeof obj.nodeId === 'string' ? obj.nodeId : '';
  const input = typeof obj.input === 'string' ? obj.input : '';
  if (!workspaceId || !nodeId) {
    return reply(res, 400, {
      ok: false,
      error: 'workspaceId and nodeId are required',
    });
  }

  const result = await sendInputToAgentNode({ workspaceId, nodeId, input });
  if (result.ok) {
    return reply(res, 200, result);
  }
  // Map the error code to a sensible HTTP status so CLI clients can
  // differentiate "wrong request" from "agent not ready".
  const status = errorStatus(result.code);
  return reply(res, status, result);
}

async function handleAgentTeamProposePlan(
  res: ServerResponse,
  obj: Record<string, unknown>,
): Promise<void> {
  const workspaceId = typeof obj.workspaceId === 'string' ? obj.workspaceId : '';
  const teamId = typeof obj.teamId === 'string' ? obj.teamId : '';
  const sourceAgentId = typeof obj.sourceAgentId === 'string' ? obj.sourceAgentId : undefined;
  const plan = obj.plan;
  if (!workspaceId || !teamId) {
    return reply(res, 400, {
      ok: false,
      error: 'workspaceId and teamId are required',
    });
  }
  if (plan == null) {
    return reply(res, 400, {
      ok: false,
      error: 'plan is required',
    });
  }

  try {
    const snapshot = await getCanvasAgentTeamsService().proposePlan(workspaceId, teamId, {
      sourceAgentId,
      plan,
    });
    return reply(res, 200, { ok: true, snapshot });
  } catch (err) {
    return reply(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}

async function handleAgentTeamCreateTask(
  res: ServerResponse,
  obj: Record<string, unknown>,
): Promise<void> {
  const workspaceId = typeof obj.workspaceId === 'string' ? obj.workspaceId : '';
  const teamId = typeof obj.teamId === 'string' ? obj.teamId : '';
  const title = typeof obj.title === 'string' ? obj.title.trim() : '';
  const description = typeof obj.description === 'string' ? obj.description.trim() : '';
  const ownerAgentId = typeof obj.ownerAgentId === 'string' ? obj.ownerAgentId : undefined;
  const ownerName = typeof obj.ownerName === 'string' ? obj.ownerName : undefined;
  const deps = Array.isArray(obj.deps) ? obj.deps.filter((dep): dep is string => typeof dep === 'string') : undefined;
  const depRefs = Array.isArray(obj.depRefs) ? obj.depRefs.filter((dep): dep is string => typeof dep === 'string') : undefined;
  const shouldDispatch = obj.dispatch === true;

  if (!workspaceId || !teamId) {
    return reply(res, 400, { ok: false, error: 'workspaceId and teamId are required' });
  }
  if (!title || !description) {
    return reply(res, 400, { ok: false, error: 'title and description are required' });
  }

  try {
    const service = getCanvasAgentTeamsService();
    await service.createTask({
      workspaceId,
      teamId,
      title,
      description,
      ownerAgentId,
      ownerName,
      deps,
      depRefs,
      dispatch: shouldDispatch,
    });
    const snapshot = await service.snapshot(workspaceId, teamId);
    return reply(res, 200, { ok: true, snapshot });
  } catch (err) {
    return reply(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}

async function handleAgentTeamCompleteTask(
  res: ServerResponse,
  obj: Record<string, unknown>,
): Promise<void> {
  const base = readTeamTaskAction(obj);
  const summary = typeof obj.summary === 'string' ? obj.summary.trim() : '';
  if (!base.workspaceId || !base.teamId) {
    return reply(res, 400, { ok: false, error: 'workspaceId and teamId are required' });
  }
  if (!summary) return reply(res, 400, { ok: false, error: 'summary is required' });

  try {
    const snapshot = await getCanvasAgentTeamsService().completeAgentTask({ ...base, summary });
    return reply(res, 200, { ok: true, snapshot });
  } catch (err) {
    return reply(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}

async function handleAgentTeamBlockTask(
  res: ServerResponse,
  obj: Record<string, unknown>,
): Promise<void> {
  const base = readTeamTaskAction(obj);
  const reason = typeof obj.reason === 'string' ? obj.reason.trim() : '';
  if (!base.workspaceId || !base.teamId) {
    return reply(res, 400, { ok: false, error: 'workspaceId and teamId are required' });
  }
  if (!reason) return reply(res, 400, { ok: false, error: 'reason is required' });

  try {
    const snapshot = await getCanvasAgentTeamsService().blockAgentTask({ ...base, reason });
    return reply(res, 200, { ok: true, snapshot });
  } catch (err) {
    return reply(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}

async function handleAgentTeamRequestHumanInput(
  res: ServerResponse,
  obj: Record<string, unknown>,
): Promise<void> {
  const base = readTeamTaskAction(obj);
  const prompt = typeof obj.prompt === 'string' ? obj.prompt.trim() : '';
  const reason = typeof obj.reason === 'string' ? obj.reason : undefined;
  if (!base.workspaceId || !base.teamId) {
    return reply(res, 400, { ok: false, error: 'workspaceId and teamId are required' });
  }
  if (!prompt) return reply(res, 400, { ok: false, error: 'prompt is required' });

  try {
    const snapshot = await getCanvasAgentTeamsService().requestHumanInput({ ...base, reason, prompt });
    return reply(res, 200, { ok: true, snapshot });
  } catch (err) {
    return reply(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}

async function handleAgentTeamPublishArtifact(
  res: ServerResponse,
  obj: Record<string, unknown>,
): Promise<void> {
  const base = readTeamTaskAction(obj);
  const title = typeof obj.title === 'string' ? obj.title.trim() : '';
  const kind = typeof obj.kind === 'string' ? obj.kind : undefined;
  const uri = typeof obj.uri === 'string' ? obj.uri : undefined;
  const summary = typeof obj.summary === 'string' ? obj.summary : undefined;
  if (!base.workspaceId || !base.teamId) {
    return reply(res, 400, { ok: false, error: 'workspaceId and teamId are required' });
  }
  if (!title) return reply(res, 400, { ok: false, error: 'title is required' });

  try {
    const snapshot = await getCanvasAgentTeamsService().publishArtifact({ ...base, kind, title, uri, summary });
    return reply(res, 200, { ok: true, snapshot });
  } catch (err) {
    return reply(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}

async function handleAgentTeamCompleteTeam(
  res: ServerResponse,
  obj: Record<string, unknown>,
): Promise<void> {
  const workspaceId = typeof obj.workspaceId === 'string' ? obj.workspaceId : '';
  const teamId = typeof obj.teamId === 'string' ? obj.teamId : '';
  const sourceAgentId = typeof obj.sourceAgentId === 'string' ? obj.sourceAgentId : undefined;
  const summary = typeof obj.summary === 'string' ? obj.summary.trim() : '';
  if (!workspaceId || !teamId) {
    return reply(res, 400, { ok: false, error: 'workspaceId and teamId are required' });
  }
  if (!summary) return reply(res, 400, { ok: false, error: 'summary is required' });

  try {
    const snapshot = await getCanvasAgentTeamsService().completeTeam(workspaceId, teamId, { sourceAgentId, summary });
    return reply(res, 200, { ok: true, snapshot });
  } catch (err) {
    return reply(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}

async function handleAgentTeamDispatch(
  res: ServerResponse,
  obj: Record<string, unknown>,
): Promise<void> {
  const workspaceId = typeof obj.workspaceId === 'string' ? obj.workspaceId : '';
  const teamId = typeof obj.teamId === 'string' ? obj.teamId : '';
  if (!workspaceId || !teamId) {
    return reply(res, 400, { ok: false, error: 'workspaceId and teamId are required' });
  }

  try {
    const snapshot = await getCanvasAgentTeamsService().dispatch(workspaceId, teamId);
    return reply(res, 200, { ok: true, snapshot });
  } catch (err) {
    return reply(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}

async function handleAgentTeamSend(
  res: ServerResponse,
  obj: Record<string, unknown>,
): Promise<void> {
  const workspaceId = typeof obj.workspaceId === 'string' ? obj.workspaceId : '';
  const teamId = typeof obj.teamId === 'string' ? obj.teamId : '';
  const to = typeof obj.to === 'string' ? obj.to : '';
  const content = typeof obj.content === 'string' ? obj.content : '';
  if (!workspaceId || !teamId || !to) {
    return reply(res, 400, { ok: false, error: 'workspaceId, teamId, and to are required' });
  }
  if (!content.trim()) {
    return reply(res, 400, { ok: false, error: 'content is required' });
  }

  try {
    const snapshot = await getCanvasAgentTeamsService().sendInput(workspaceId, teamId, to, content);
    return reply(res, 200, { ok: true, snapshot });
  } catch (err) {
    return reply(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}

function errorStatus(code: string): number {
  switch (code) {
    case 'workspace_not_found':
    case 'node_not_found':
      return 404;
    case 'wrong_node_type':
      return 400;
    case 'not_running':
    case 'no_session':
      return 409;
    default:
      return 500;
  }
}

function reply(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.setHeader('content-length', Buffer.byteLength(json).toString());
  res.end(json);
}

function readBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let received = 0;
    req.on('data', (chunk: Buffer) => {
      received += chunk.length;
      if (received > maxBytes) {
        reject(new Error(`request body exceeds ${maxBytes} bytes`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// Exported for tests.
export const __test = { RUNTIME_FILE, RUNTIME_DIR };
export const RUNTIME_FILE_PATH = RUNTIME_FILE;
export const RUNTIME_DIR_PATH = RUNTIME_DIR;
