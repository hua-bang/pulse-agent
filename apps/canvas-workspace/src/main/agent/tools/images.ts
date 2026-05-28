import { promises as fs } from 'fs';
import { join, basename } from 'path';
import { z } from 'zod';
import { GenerateImageTool } from 'pulse-coder-engine';
import type { CanvasTool, MindmapTopic } from './types';
import { STORE_DIR, loadCanvas } from './_shared/canvas-io';
import { flattenMindmapForPrompt } from './_shared/mindmap';
import {
  analyzeImagesWithGemini,
  analyzeImagesWithOpenAI,
  resolveImageInputs,
} from './_shared/vision-clients';

export function createImageTools(workspaceId: string): Record<string, CanvasTool> {
  return {
    canvas_analyze_image: {
      name: 'canvas_analyze_image',
      defer_loading: true,
      description:
        'Read/analyze one or more image nodes or local image paths using a vision model. ' +
        'Use this when the user asks what is in an image on the canvas, asks to OCR/summarize a picture, ' +
        'or wants a mindmap created from an image. For image nodes, pass nodeIds. For local files, pass imagePaths.',
      inputSchema: z.object({
        nodeIds: z.array(z.string()).optional().describe('Canvas image node IDs to analyze.'),
        imagePaths: z.array(z.string()).optional().describe('Local image file paths to analyze.'),
        prompt: z.string().optional().describe('Question/instruction for the image analysis.'),
        maxImages: z.number().int().positive().max(10).optional().describe('Maximum image count. Defaults to 6.'),
        provider: z.enum(['openai', 'gpt', 'gemini']).optional().describe('Vision provider. Defaults to OpenAI/GPT.'),
        model: z.string().optional().describe('Vision model override.'),
        detail: z.enum(['auto', 'low', 'high']).optional().describe('OpenAI image detail level.'),
        visionApiMode: z.enum(['responses', 'chat_completions', 'auto']).optional().describe('OpenAI vision API mode.'),
      }),
      execute: async (input) => {
        const canvas = await loadCanvas(workspaceId);
        if (!canvas) return 'Error: workspace not found';

        const prompt = (input.prompt as string | undefined)?.trim()
          || 'Describe the image, OCR visible text, extract key facts, and answer the user request. If useful, return a concise structured outline.';
        const images = await resolveImageInputs(canvas, {
          nodeIds: input.nodeIds as string[] | undefined,
          imagePaths: input.imagePaths as string[] | undefined,
          maxImages: input.maxImages as number | undefined,
        });
        const provider = (input.provider as string | undefined) === 'gemini' ? 'gemini' : 'openai';
        const result = provider === 'gemini'
          ? await analyzeImagesWithGemini({
              prompt,
              images,
              model: input.model as string | undefined,
            })
          : await analyzeImagesWithOpenAI({
              prompt,
              images,
              model: input.model as string | undefined,
              detail: input.detail as 'auto' | 'low' | 'high' | undefined,
              visionApiMode: input.visionApiMode as 'responses' | 'chat_completions' | 'auto' | undefined,
            });

        return JSON.stringify({
          ok: true,
          ...result,
          imageCount: images.length,
          imagePaths: images.map((image) => image.path),
          sources: images.map((image) => image.source),
        }, null, 2);
      },
    },

    canvas_generate_image: {
      name: 'canvas_generate_image',
      defer_loading: true,
      description:
        'Generate an image with the engine generate_image implementation and return it to the chat. ' +
        'Use this when the user asks to create/draw/generate a picture, diagram, poster, or visual asset. ' +
        'By default this DOES NOT add anything to the canvas; the chat UI shows a quick Add to canvas button. ' +
        'If the generated image should reflect a mindmap, pass sourceMindmapNodeId so the prompt includes the mindmap topic tree.',
      inputSchema: z.object({
        prompt: z.string().describe('Detailed image generation prompt.'),
        title: z.string().optional().describe('Suggested image title shown in chat.'),
        sourceMindmapNodeId: z.string().optional().describe('Optional mindmap node ID whose topic tree should be included in the generation prompt.'),
        provider: z.enum(['openai', 'gpt', 'gemini']).optional().describe('Image provider. Defaults to OpenAI/GPT.'),
        model: z.string().optional().describe('Image generation model override.'),
        size: z.string().optional().describe('OpenAI/GPT image size, e.g. 1024x1024 or auto.'),
        quality: z.string().optional().describe('OpenAI/GPT image quality.'),
        outputFormat: z.enum(['png', 'jpeg', 'webp']).optional().describe('Output format.'),
        imageApiMode: z.enum(['images', 'responses', 'responses_stream', 'auto']).optional().describe('OpenAI/GPT image API mode.'),
      }),
      execute: async (input) => {
        const canvas = await loadCanvas(workspaceId);
        if (!canvas) return 'Error: workspace not found';

        let prompt = (input.prompt as string).trim();
        if (!prompt) return 'Error: prompt is required';

        const sourceMindmapNodeId = input.sourceMindmapNodeId as string | undefined;
        if (sourceMindmapNodeId) {
          const source = canvas.nodes.find((node) => node.id === sourceMindmapNodeId);
          if (!source) return `Error: mindmap node not found: ${sourceMindmapNodeId}`;
          if (source.type !== 'mindmap') return `Error: source node is not a mindmap: ${sourceMindmapNodeId}`;
          const root = source.data.root as MindmapTopic | undefined;
          const outline = flattenMindmapForPrompt(root);
          prompt += `

Use this mindmap structure as source content:
${outline}`;
        }

        const imagesDir = join(STORE_DIR, workspaceId, 'images');
        await fs.mkdir(imagesDir, { recursive: true });
        const requestedFormat = input.outputFormat as 'png' | 'jpeg' | 'webp' | undefined;
        const outputExt = requestedFormat ?? 'png';
        const outputPath = join(imagesDir, `generated-${Date.now()}.${outputExt}`);
        const generated = await GenerateImageTool.execute({
          prompt,
          provider: input.provider as 'openai' | 'gpt' | 'gemini' | undefined,
          model: input.model as string | undefined,
          outputPath,
          size: input.size as string | undefined,
          quality: input.quality as string | undefined,
          outputFormat: requestedFormat,
          imageApiMode: input.imageApiMode as 'images' | 'responses' | 'responses_stream' | 'auto' | undefined,
        });

        return JSON.stringify({
          ok: true,
          type: 'generated_image',
          title: (input.title as string | undefined)?.trim() || basename(generated.outputPath),
          outputPath: generated.outputPath,
          mimeType: generated.mimeType,
          bytes: generated.bytes,
          provider: generated.provider,
          model: generated.model,
          addToCanvasAction: {
            workspaceId,
            imagePath: generated.outputPath,
          },
        }, null, 2);
      },
    },

    canvas_generate_mindmap_image: {
      name: 'canvas_generate_mindmap_image',
      defer_loading: true,
      description:
        'Generate a visual image from an existing mindmap node and return it to the chat. ' +
        'Use this for requests like "turn this mindmap into an image/poster/diagram". ' +
        'By default this does not write to the canvas; the chat UI offers an Add to canvas button.',
      inputSchema: z.object({
        mindmapNodeId: z.string().describe('Mindmap node ID to visualize.'),
        prompt: z.string().optional().describe('Optional style/composition instructions.'),
        title: z.string().optional().describe('Suggested image title shown in chat.'),
        provider: z.enum(['openai', 'gpt', 'gemini']).optional().describe('Image provider. Defaults to OpenAI/GPT.'),
        model: z.string().optional().describe('Image generation model override.'),
        size: z.string().optional().describe('OpenAI/GPT image size.'),
        quality: z.string().optional().describe('OpenAI/GPT image quality.'),
        outputFormat: z.enum(['png', 'jpeg', 'webp']).optional().describe('Output format.'),
        imageApiMode: z.enum(['images', 'responses', 'responses_stream', 'auto']).optional().describe('OpenAI/GPT image API mode.'),
      }),
      execute: async (input) => {
        const canvas = await loadCanvas(workspaceId);
        if (!canvas) return 'Error: workspace not found';
        const source = canvas.nodes.find((node) => node.id === input.mindmapNodeId);
        if (!source) return `Error: mindmap node not found: ${input.mindmapNodeId}`;
        if (source.type !== 'mindmap') return `Error: source node is not a mindmap: ${input.mindmapNodeId}`;

        const root = source.data.root as MindmapTopic | undefined;
        const outline = flattenMindmapForPrompt(root);
        const stylePrompt = (input.prompt as string | undefined)?.trim()
          || 'Create a clean, readable visual mindmap/infographic with clear hierarchy, spacious layout, and polished typography.';
        const prompt = `${stylePrompt}\n\nMindmap structure:\n${outline}`;

        const imagesDir = join(STORE_DIR, workspaceId, 'images');
        await fs.mkdir(imagesDir, { recursive: true });
        const result = await GenerateImageTool.execute({
          prompt,
          provider: input.provider as 'openai' | 'gpt' | 'gemini' | undefined,
          model: input.model as string | undefined,
          outputPath: join(imagesDir, `mindmap-${Date.now()}.${input.outputFormat ?? 'png'}`),
          size: input.size as string | undefined,
          quality: input.quality as string | undefined,
          outputFormat: input.outputFormat as 'png' | 'jpeg' | 'webp' | undefined,
          imageApiMode: input.imageApiMode as 'images' | 'responses' | 'responses_stream' | 'auto' | undefined,
        });

        return JSON.stringify({
          ok: true,
          type: 'generated_image',
          title: (input.title as string | undefined)?.trim() || `${source.title || 'Mindmap'} image`,
          sourceMindmapNodeId: source.id,
          outputPath: result.outputPath,
          mimeType: result.mimeType,
          bytes: result.bytes,
          provider: result.provider,
          model: result.model,
          addToCanvasAction: {
            workspaceId,
            imagePath: result.outputPath,
          },
        }, null, 2);
      },
    },
  };
}
