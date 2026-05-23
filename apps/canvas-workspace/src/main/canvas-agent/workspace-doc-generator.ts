/**
 * One-shot LLM helper for drafting `pulse-workspace.md` from a short
 * user-provided intent line. Triggered explicitly from the workspace
 * settings drawer ("✨ Generate"); never invoked autonomously by the
 * Canvas Agent loop.
 *
 * Mirrors the shape of html-generator.ts so the model config / streaming
 * plumbing stays consistent across the app.
 */

import { generateText, streamText } from 'ai';
import { resolveCanvasModel } from './model-config';

const SYSTEM_PROMPT = `You generate concise, structured "Pulse Workspace" documents in markdown.

The user gives you a short description of what a workspace is for. You produce a markdown document with this exact structure:

# <Workspace Name>

## Goal
<1-3 sentences describing what this workspace is trying to accomplish.>

## Status
<1-2 sentences describing where things stand. For a brand-new workspace, write something like "Just getting started — defining scope." Avoid placeholder text.>

## Notes
<Optional bulleted list capturing decisions, references, or open questions hinted at in the description. If the description doesn't suggest any, omit this entire section.>

Rules:
- Output ONLY the markdown document. No preamble, no explanation, no code fences.
- Use the provided workspace name verbatim in the H1 heading.
- Match the user's language. If they describe the workspace in Chinese, write the whole document in Chinese; if English, write in English.
- Keep it short and high-signal — the document is meant to be skimmed in 10 seconds.
- Do not invent facts, links, dates, or commitments that the user didn't mention.
- If an existing document is provided, treat the new description as an UPDATE: preserve good context from the existing Goal / Notes, refresh Status to reflect what the user just said, only rewrite sections that need to change.`;

function buildUserPrompt(
  workspaceName: string,
  intent: string,
  currentContent?: string,
): string {
  const lines: string[] = [`Workspace name: ${workspaceName}`, '', 'User description:', intent.trim()];
  if (currentContent && currentContent.trim().length > 0) {
    lines.push('', 'Existing pulse-workspace.md to integrate with (preserve what still applies, refresh what changed):', '---', currentContent.trim(), '---');
  }
  return lines.join('\n');
}

function stripFences(text: string): string {
  let md = text.trim();
  if (md.startsWith('```')) {
    md = md.replace(/^```(?:markdown|md)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }
  return md;
}

export async function generateWorkspaceDoc(
  workspaceName: string,
  intent: string,
  currentContent?: string,
): Promise<{ ok: boolean; content?: string; error?: string }> {
  try {
    const modelConfig = await resolveCanvasModel();
    const { text } = await generateText({
      model: modelConfig.provider(modelConfig.model),
      system: SYSTEM_PROMPT,
      prompt: buildUserPrompt(workspaceName, intent, currentContent),
    });
    return { ok: true, content: stripFences(text) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function streamWorkspaceDoc(
  workspaceName: string,
  intent: string,
  currentContent: string | undefined,
  onDelta: (delta: string) => void,
): Promise<{ ok: boolean; content?: string; error?: string }> {
  try {
    const modelConfig = await resolveCanvasModel();
    const result = streamText({
      model: modelConfig.provider(modelConfig.model),
      system: SYSTEM_PROMPT,
      prompt: buildUserPrompt(workspaceName, intent, currentContent),
    });

    let accumulated = '';
    for await (const part of result.textStream) {
      accumulated += part;
      onDelta(part);
    }

    return { ok: true, content: stripFences(accumulated) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
