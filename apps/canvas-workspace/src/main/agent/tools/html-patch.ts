import { z } from 'zod';
import {
  addArtifactVersion,
  getArtifact,
  getCurrentVersionContent,
} from '../../artifacts/store';
import { broadcastUpdate } from './_shared/broadcast';
import { loadCanvas, saveCanvas } from './_shared/canvas-io';
import {
  htmlPatchOperationSchema,
  type HtmlPatchOperation,
} from './_shared/html-patch-schema';
import type { CanvasTool } from './types';

const patchHtmlContent = async (html: string, operations: HtmlPatchOperation[]) => {
  const patcher = await import('./_shared/html-patch');
  return patcher.patchHtmlContent(html, operations);
};

const targetSchema = z.object({
  nodeId: z.string().optional().describe('Patch an iframe HTML node. Artifact-backed iframe nodes patch the artifact.'),
  artifactId: z.string().optional().describe('Patch an HTML artifact by adding a new current version.'),
}).refine(
  value => !!value.nodeId !== !!value.artifactId,
  { message: 'Provide exactly one of nodeId or artifactId.' },
);

export const htmlPatchInputSchema = z.object({
  nodeId: z.string().optional().describe('Patch an iframe HTML node.'),
  artifactId: z.string().optional().describe('Patch an HTML artifact by adding a new current version.'),
  target: targetSchema.optional().describe('Structured target. Prefer this when targeting artifacts.'),
  operations: z.array(htmlPatchOperationSchema).min(1).max(50),
  prompt: z.string().optional().describe('Optional note stored with artifact versions for traceability.'),
});

function resolveTarget(input: {
  nodeId?: string;
  artifactId?: string;
  target?: { nodeId?: string; artifactId?: string };
}): { nodeId?: string; artifactId?: string } | { error: string } {
  const nodeIds = [input.nodeId, input.target?.nodeId].filter((value): value is string => !!value);
  const artifactIds = [input.artifactId, input.target?.artifactId].filter((value): value is string => !!value);
  const uniqueNodeIds = new Set(nodeIds);
  const uniqueArtifactIds = new Set(artifactIds);

  if (uniqueNodeIds.size > 1) {
    return { error: 'Conflicting nodeId values provided.' };
  }
  if (uniqueArtifactIds.size > 1) {
    return { error: 'Conflicting artifactId values provided.' };
  }
  if (uniqueNodeIds.size + uniqueArtifactIds.size !== 1) {
    return { error: 'Provide exactly one of nodeId or artifactId.' };
  }

  return {
    nodeId: nodeIds[0],
    artifactId: artifactIds[0],
  };
}

async function patchArtifact(
  workspaceId: string,
  artifactId: string,
  operations: HtmlPatchOperation[],
  prompt?: string,
): Promise<string> {
  const current = await getCurrentVersionContent(workspaceId, artifactId);
  if (!current) {
    return JSON.stringify({ ok: false, error: `Artifact not found or has no current version: ${artifactId}` });
  }
  if (current.type !== 'html') {
    return JSON.stringify({ ok: false, error: `artifact is not html: ${artifactId}` });
  }

  const result = await patchHtmlContent(current.content, operations);
  const artifact = await addArtifactVersion(workspaceId, artifactId, {
    content: result.html,
    prompt,
  });
  if (!artifact) {
    return JSON.stringify({ ok: false, error: `Artifact not found: ${artifactId}` });
  }

  return JSON.stringify({
    ok: true,
    target: 'artifact',
    artifactId,
    versionId: artifact.currentVersionId,
    versionCount: artifact.versions.length,
    applied: result.applied,
  });
}

async function patchNode(
  workspaceId: string,
  nodeId: string,
  operations: HtmlPatchOperation[],
  prompt?: string,
): Promise<string> {
  const initial = await loadCanvas(workspaceId);
  if (!initial) return JSON.stringify({ ok: false, error: 'workspace not found' });
  const initialNode = initial.nodes.find(node => node.id === nodeId);
  if (!initialNode) return JSON.stringify({ ok: false, error: `node not found: ${nodeId}` });
  if (initialNode.type !== 'iframe') {
    return JSON.stringify({ ok: false, error: `node is not an iframe: ${nodeId}` });
  }

  const artifactId = typeof initialNode.data.artifactId === 'string' ? initialNode.data.artifactId : undefined;
  if (artifactId) {
    const artifact = await getArtifact(workspaceId, artifactId);
    if (!artifact) return JSON.stringify({ ok: false, error: `artifact not found for node ${nodeId}: ${artifactId}` });
    return patchArtifact(workspaceId, artifactId, operations, prompt);
  }

  const currentHtml = typeof initialNode.data.html === 'string' ? initialNode.data.html : '';
  if (!currentHtml.trim()) {
    return JSON.stringify({ ok: false, error: `iframe node has no local HTML to patch: ${nodeId}` });
  }

  const result = await patchHtmlContent(currentHtml, operations);

  const fresh = (await loadCanvas(workspaceId)) ?? initial;
  const idx = fresh.nodes.findIndex(node => node.id === nodeId);
  if (idx === -1) {
    return JSON.stringify({ ok: false, error: `node ${nodeId} was deleted concurrently; update aborted` });
  }

  fresh.nodes[idx].data.html = result.html;
  fresh.nodes[idx].updatedAt = Date.now();
  await saveCanvas(workspaceId, fresh);
  broadcastUpdate(workspaceId, [nodeId]);

  return JSON.stringify({
    ok: true,
    target: 'node',
    nodeId,
    applied: result.applied,
  });
}

export function createHtmlPatchTools(workspaceId: string): Record<string, CanvasTool> {
  return {
    canvas_patch_html_node: {
      name: 'canvas_patch_html_node',
      defer_loading: true,
      description:
        'Incrementally patch the HTML inside an iframe node or an HTML artifact using CSS selectors. ' +
        'Use this for targeted DOM review fixes instead of regenerating full HTML. ' +
        'Supports setText, setAttribute, removeAttribute, setCssProperty, insertHTML, replaceInnerHTML, replaceOuterHTML, and remove. ' +
        'For node targets, only local HTML/AI iframe nodes can be patched directly; artifact-backed iframe nodes patch the referenced artifact. ' +
        'External URL iframe nodes cannot be patched because their HTML is not stored locally.',
      inputSchema: htmlPatchInputSchema,
      execute: async (input) => {
        const target = resolveTarget(input as {
          nodeId?: string;
          artifactId?: string;
          target?: { nodeId?: string; artifactId?: string };
        });
        if ('error' in target) {
          return JSON.stringify({ ok: false, error: target.error });
        }

        const operations = input.operations as HtmlPatchOperation[];
        const prompt = input.prompt as string | undefined;

        try {
          if (target.artifactId) {
            return await patchArtifact(workspaceId, target.artifactId, operations, prompt);
          }
          if (target.nodeId) {
            return await patchNode(workspaceId, target.nodeId, operations, prompt);
          }
          return JSON.stringify({ ok: false, error: 'Provide exactly one of nodeId or artifactId.' });
        } catch (err) {
          return JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) });
        }
      },
    },
  };
}
