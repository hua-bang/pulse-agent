/**
 * IPC for artifact runtime capabilities (see shared/artifact-capabilities.ts
 * for the trust model).
 *
 * Channels:
 *  - `artifact-capability:invoke` — execute one declared capability for an
 *    artifact page. Main-side validation is authoritative: the artifact must
 *    exist and declare the capability, and payloads are shape/size-capped.
 *
 * Capabilities:
 *  - memory.adopt — write ONE user-confirmed memory candidate (the page's
 *    采纳 button click IS the confirmation; the renderer bridge additionally
 *    gates on a real user gesture).
 *  - skill.save — save ONE user-confirmed skill draft via the same
 *    upsertCanvasSkill path canvas_save_skill uses.
 */

import { ipcMain } from 'electron';
import type {
  ArtifactCapabilityInvoke,
  ArtifactCapabilityResult,
  MemoryAdoptPayload,
  SkillSavePayload,
} from '../../shared/artifact-capabilities';
import { getArtifact } from './store';

const MAX_CONTENT_CHARS = 500;
const MAX_SKILL_BODY_CHARS = 20_000;
const MEMORY_KINDS = new Set(['preference', 'fact', 'decision', 'rule', 'note']);

async function adoptMemory(payload: MemoryAdoptPayload): Promise<ArtifactCapabilityResult> {
  const content = typeof payload.content === 'string' ? payload.content.trim() : '';
  if (!content || content.length > MAX_CONTENT_CHARS) {
    return { ok: false, error: `content must be 1-${MAX_CONTENT_CHARS} chars` };
  }
  const kind = payload.kind && MEMORY_KINDS.has(payload.kind) ? payload.kind : 'note';

  const { saveMemory } = await import('../agent/memory-store');
  const workspaceId = payload.workspaceId?.trim();
  if (workspaceId) {
    const { listWorkspaces } = await import('../canvas/workspaces');
    const known = new Set((await listWorkspaces()).workspaces.map((w) => w.id));
    if (!known.has(workspaceId)) {
      return { ok: false, error: `unknown workspaceId "${workspaceId}"` };
    }
    await saveMemory({ kind: 'workspace', workspaceId }, content, kind);
    return { ok: true, summary: `已采纳 1 条记忆 → 工作区 ${workspaceId}` };
  }
  await saveMemory({ kind: 'global' }, content, kind);
  return { ok: true, summary: '已采纳 1 条记忆 → 全局' };
}

async function saveSkill(payload: SkillSavePayload): Promise<ArtifactCapabilityResult> {
  const name = typeof payload.name === 'string' ? payload.name.trim() : '';
  const description = typeof payload.description === 'string' ? payload.description.trim() : '';
  const body = typeof payload.body === 'string' ? payload.body.trim() : '';
  if (!name || name.length > 80 || !description || description.length > 500) {
    return { ok: false, error: 'invalid skill name/description' };
  }
  if (!body || body.length > MAX_SKILL_BODY_CHARS) {
    return { ok: false, error: `skill body must be 1-${MAX_SKILL_BODY_CHARS} chars` };
  }

  const { upsertCanvasSkill } = await import('../agent/skills/config');
  if (payload.scope === 'workspace') {
    const workspaceId = payload.workspaceId?.trim();
    if (!workspaceId) return { ok: false, error: 'workspaceId required for workspace scope' };
    const { listWorkspaces } = await import('../canvas/workspaces');
    const known = new Set((await listWorkspaces()).workspaces.map((w) => w.id));
    if (!known.has(workspaceId)) {
      return { ok: false, error: `unknown workspaceId "${workspaceId}"` };
    }
    await upsertCanvasSkill({ level: 'workspace', workspaceId }, { name, description, body });
    return { ok: true, summary: `已保存 skill "${name}" → 工作区 ${workspaceId}` };
  }
  await upsertCanvasSkill({ level: 'global' }, { name, description, body });
  return { ok: true, summary: `已保存 skill "${name}" → 全局` };
}

/** Exported for tests; the IPC handler is a thin wrapper. */
export async function invokeArtifactCapability(
  request: ArtifactCapabilityInvoke,
): Promise<ArtifactCapabilityResult> {
  try {
    const artifact = await getArtifact(request.workspaceId, request.artifactId);
    if (!artifact) return { ok: false, error: 'artifact not found' };
    if (!artifact.capabilities?.includes(request.capability)) {
      return { ok: false, error: `capability not declared: ${request.capability}` };
    }
    if (request.capability === 'memory.adopt') {
      return await adoptMemory(request.payload as MemoryAdoptPayload);
    }
    if (request.capability === 'skill.save') {
      return await saveSkill(request.payload as SkillSavePayload);
    }
    return { ok: false, error: `unknown capability` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function setupArtifactCapabilityIpc(): void {
  ipcMain.handle(
    'artifact-capability:invoke',
    async (_event, request: ArtifactCapabilityInvoke): Promise<ArtifactCapabilityResult> =>
      invokeArtifactCapability(request),
  );
}
