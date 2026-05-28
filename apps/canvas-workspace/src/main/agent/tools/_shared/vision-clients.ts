import { promises as fs } from 'fs';
import type { CanvasSaveData } from '../types';
import { resolveImageMimeType } from './image-io';

export async function resolveImageInputs(
  canvas: CanvasSaveData,
  input: { nodeIds?: string[]; imagePaths?: string[]; maxImages?: number },
): Promise<Array<{ path: string; source: string; mimeType: string; base64: string }>> {
  const maxImages = input.maxImages ?? 6;
  const paths: Array<{ path: string; source: string }> = [];

  for (const nodeId of input.nodeIds ?? []) {
    const node = canvas.nodes.find((n) => n.id === nodeId);
    if (!node) throw new Error(`Image node not found: ${nodeId}`);
    if (node.type !== 'image') throw new Error(`Node is not an image node: ${nodeId}`);
    const filePath = node.data.filePath as string | undefined;
    if (!filePath) throw new Error(`Image node has no filePath: ${nodeId}`);
    paths.push({ path: filePath, source: `node:${nodeId}` });
  }

  for (const imagePath of input.imagePaths ?? []) {
    if (imagePath.trim()) paths.push({ path: imagePath.trim(), source: 'path' });
  }

  if (paths.length === 0) {
    throw new Error('Provide image nodeIds or local imagePaths to analyze.');
  }

  const limited = paths.slice(0, maxImages);
  return Promise.all(limited.map(async (item) => {
    const buffer = await fs.readFile(item.path);
    return {
      ...item,
      mimeType: resolveImageMimeType(item.path),
      base64: buffer.toString('base64'),
    };
  }));
}

export function extractOpenAIResponsesText(data: any): string {
  const chunks: string[] = [];
  for (const item of data?.output ?? []) {
    for (const content of item?.content ?? []) {
      if (typeof content?.text === 'string') chunks.push(content.text);
    }
  }
  return chunks.join('\n').trim();
}

export function extractOpenAIChatText(data: any): string {
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) => typeof part?.text === 'string' ? part.text : '')
      .filter(Boolean)
      .join('\n')
      .trim();
  }
  return '';
}

export async function analyzeImagesWithOpenAI(args: {
  prompt: string;
  images: Array<{ base64: string; mimeType: string }>;
  model?: string;
  detail?: 'auto' | 'low' | 'high';
  visionApiMode?: 'responses' | 'chat_completions' | 'auto';
}): Promise<{ provider: 'openai'; model: string; text: string }> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error('OPENAI_API_KEY environment variable is not set');

  const apiUrl = (process.env.OPENAI_API_URL?.trim() || 'https://api.openai.com/v1').replace(/\/$/, '');
  const model = args.model?.trim() || process.env.OPENAI_VISION_MODEL?.trim() || 'gpt-5.4';
  const mode = args.visionApiMode ?? 'responses';
  const detail = args.detail ?? 'auto';

  const runResponses = async () => {
    const response = await fetch(`${apiUrl}/responses`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        input: [{
          role: 'user',
          content: [
            { type: 'input_text', text: args.prompt },
            ...args.images.map((image) => ({
              type: 'input_image',
              image_url: `data:${image.mimeType};base64,${image.base64}`,
              detail,
            })),
          ],
        }],
      }),
    });
    const data = await response.json() as any;
    if (!response.ok) {
      throw new Error(`OpenAI vision API error: ${response.status} ${response.statusText} - ${JSON.stringify(data?.error ?? data)}`);
    }
    const text = extractOpenAIResponsesText(data);
    if (!text) throw new Error('OpenAI vision response did not include text');
    return text;
  };

  const runChatCompletions = async () => {
    const response = await fetch(`${apiUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: args.prompt },
            ...args.images.map((image) => ({
              type: 'image_url',
              image_url: {
                url: `data:${image.mimeType};base64,${image.base64}`,
                detail,
              },
            })),
          ],
        }],
      }),
    });
    const data = await response.json() as any;
    if (!response.ok) {
      throw new Error(`OpenAI chat vision API error: ${response.status} ${response.statusText} - ${JSON.stringify(data?.error ?? data)}`);
    }
    const text = extractOpenAIChatText(data);
    if (!text) throw new Error('OpenAI chat vision response did not include text');
    return text;
  };

  if (mode === 'chat_completions') {
    return { provider: 'openai', model, text: await runChatCompletions() };
  }
  if (mode === 'auto') {
    try {
      return { provider: 'openai', model, text: await runResponses() };
    } catch {
      return { provider: 'openai', model, text: await runChatCompletions() };
    }
  }
  return { provider: 'openai', model, text: await runResponses() };
}

export async function analyzeImagesWithGemini(args: {
  prompt: string;
  images: Array<{ base64: string; mimeType: string }>;
  model?: string;
}): Promise<{ provider: 'gemini'; model: string; text: string }> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error('GEMINI_API_KEY environment variable is not set');

  const baseUrl = (process.env.GEMINI_API_BASE_URL?.trim() || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, '');
  const model = args.model?.trim() || process.env.GEMINI_VISION_MODEL?.trim() || 'gemini-2.5-flash';
  const response = await fetch(`${baseUrl}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        role: 'user',
        parts: [
          { text: args.prompt },
          ...args.images.map((image) => ({
            inline_data: {
              mime_type: image.mimeType,
              data: image.base64,
            },
          })),
        ],
      }],
    }),
  });
  const data = await response.json() as any;
  if (!response.ok) {
    throw new Error(`Gemini vision API error: ${response.status} ${response.statusText} - ${JSON.stringify(data?.error ?? data)}`);
  }
  const text = (data?.candidates ?? [])
    .flatMap((candidate: any) => candidate?.content?.parts ?? [])
    .map((part: any) => typeof part?.text === 'string' ? part.text : '')
    .filter(Boolean)
    .join('\n')
    .trim();
  if (!text) {
    const blockReason = data?.promptFeedback?.blockReason;
    if (blockReason) throw new Error(`Gemini vision blocked the request: ${blockReason}`);
    throw new Error('Gemini vision response did not include text');
  }
  return { provider: 'gemini', model, text };
}
