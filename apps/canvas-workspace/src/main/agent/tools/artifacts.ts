import { z } from 'zod';
import {
  addArtifactVersion as storeAddArtifactVersion,
  createArtifact as storeCreateArtifact,
  getArtifact as storeGetArtifact,
} from '../../artifacts/store';
import { pinArtifactToCanvas } from '../../artifacts/ipc';
import type { CanvasTool } from './types';

export function createArtifactTools(workspaceId: string): Record<string, CanvasTool> {
  return {
    artifact_create: {
      name: 'artifact_create',
      description:
        'Create a persistent, versioned visual artifact. Surfaces in chat as an artifact card with a side drawer for preview, version history, and "Pin to Canvas". ' +
        'Use this when the user asks for something to KEEP, RE-USE, or ITERATE on (dashboards, full-page mockups, polished diagrams). ' +
        'For throwaway visuals that just illustrate a point mid-explanation, use `visual_render` instead. ' +
        'Content format matches `visual_render`: a self-contained HTML doc for type=html.',
      inputSchema: z.object({
        type: z.enum(['html', 'svg', 'mermaid']).describe('Artifact type. `html` renders in a sandboxed iframe; `svg` renders the element directly; `mermaid` parses the source and renders as an SVG diagram.'),
        title: z.string().describe('Short title — appears in the artifact card and as the canvas node title once pinned.'),
        content: z.string().describe('Full content of the first version.'),
        prompt: z.string().optional().describe('Optional record of the prompt/spec that produced this version (helps diff future iterations).'),
      }),
      execute: async (input) => {
        const type = input.type as 'html' | 'svg' | 'mermaid';
        const title = (input.title as string) ?? 'Untitled artifact';
        const content = (input.content as string) ?? '';
        const prompt = input.prompt as string | undefined;
        if (!content.trim()) {
          return JSON.stringify({ ok: false, error: 'content is empty' });
        }
        const artifact = await storeCreateArtifact(workspaceId, {
          type,
          title,
          content,
          prompt,
          source: { origin: 'agent_tool' },
        });
        return JSON.stringify({
          ok: true,
          kind: 'artifact_create',
          artifactId: artifact.id,
          versionId: artifact.currentVersionId,
          type: artifact.type,
          title: artifact.title,
        });
      },
    },

    artifact_update: {
      name: 'artifact_update',
      defer_loading: true,
      description:
        'Add a new version to an existing artifact. The new version becomes the current one; previous versions remain accessible in the drawer. ' +
        'Use this when the user asks to refine, iterate on, or fix an artifact you (or a previous turn) already created. ' +
        'Pass the same artifactId returned by `artifact_create`.',
      inputSchema: z.object({
        artifactId: z.string().describe('The artifact to iterate on (returned by an earlier artifact_create call).'),
        content: z.string().describe('Full content of the new version — this replaces, not patches.'),
        prompt: z.string().optional().describe('Optional prompt/spec that produced this iteration.'),
      }),
      execute: async (input) => {
        const artifactId = input.artifactId as string;
        const content = (input.content as string) ?? '';
        const prompt = input.prompt as string | undefined;
        if (!content.trim()) {
          return JSON.stringify({ ok: false, error: 'content is empty' });
        }
        const existing = await storeGetArtifact(workspaceId, artifactId);
        if (!existing) {
          return JSON.stringify({ ok: false, error: `Artifact not found: ${artifactId}` });
        }
        const artifact = await storeAddArtifactVersion(workspaceId, artifactId, { content, prompt });
        if (!artifact) {
          return JSON.stringify({ ok: false, error: `Artifact not found: ${artifactId}` });
        }
        return JSON.stringify({
          ok: true,
          kind: 'artifact_update',
          artifactId: artifact.id,
          versionId: artifact.currentVersionId,
          versionCount: artifact.versions.length,
          type: artifact.type,
          title: artifact.title,
        });
      },
    },

    artifact_pin_to_canvas: {
      name: 'artifact_pin_to_canvas',
      defer_loading: true,
      description:
        'Pin an existing artifact onto the spatial canvas as an iframe node. The node renders the artifact\'s current version live — any future `artifact_update` ' +
        'updates the on-canvas node too. Use this when the user asks to keep multiple visuals side by side, compare options, or build a spatial dashboard.',
      inputSchema: z.object({
        artifactId: z.string().describe('The artifact to pin.'),
        x: z.number().optional().describe('Top-left x (auto-placed if omitted).'),
        y: z.number().optional().describe('Top-left y (auto-placed if omitted).'),
        width: z.number().optional().describe('Width in px (default 520).'),
        height: z.number().optional().describe('Height in px (default 400).'),
        title: z.string().optional().describe('Override the on-canvas node title (defaults to the artifact title).'),
      }),
      execute: async (input) => {
        const artifactId = input.artifactId as string;
        const result = await pinArtifactToCanvas(workspaceId, artifactId, {
          x: input.x as number | undefined,
          y: input.y as number | undefined,
          width: input.width as number | undefined,
          height: input.height as number | undefined,
          title: input.title as string | undefined,
        });
        if ('error' in result) {
          return JSON.stringify({ ok: false, error: result.error });
        }
        return JSON.stringify({
          ok: true,
          kind: 'artifact_pin_to_canvas',
          nodeId: result.nodeId,
          artifactId: result.artifact.id,
          title: result.artifact.title,
        });
      },
    },
  };
}
