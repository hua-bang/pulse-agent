import { generateText } from 'ai';
import { resolveCanvasModel } from './model/config';

const SYSTEM_PROMPT = `You write clear instructions for a recurring AI task.

Return only the finished task instructions, with no preamble, quotation marks, or code fence.

Rules:
- Match the user's language.
- Preserve the user's intent; do not invent data sources, permissions, recipients, or commitments.
- State the desired output, useful scope, and what to do when required context is unavailable.
- Write instructions that remain valid on every recurring run.
- Keep the result concise and directly editable.`;

const buildPrompt = (title: string, currentPrompt?: string): string => [
  `Task name: ${title.trim() || 'Untitled scheduled task'}`,
  '',
  currentPrompt?.trim()
    ? `Current instructions to improve:\n${currentPrompt.trim()}`
    : 'Draft useful recurring instructions from the task name.',
].join('\n');

const stripFences = (value: string): string => value
  .trim()
  .replace(/^```(?:markdown|md|text)?\s*\n?/, '')
  .replace(/\n?```\s*$/, '')
  .trim();

export async function generateScheduledPrompt(
  title: string,
  currentPrompt?: string,
): Promise<{ ok: boolean; content?: string; error?: string }> {
  try {
    const modelConfig = await resolveCanvasModel();
    const { text } = await generateText({
      model: modelConfig.provider(modelConfig.model),
      system: SYSTEM_PROMPT,
      prompt: buildPrompt(title, currentPrompt),
    });
    const content = stripFences(text);
    return content
      ? { ok: true, content }
      : { ok: false, error: 'The model returned empty instructions' };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
