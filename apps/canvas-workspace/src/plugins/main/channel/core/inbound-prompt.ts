import type { InboundMessage } from './types';

/**
 * Build the prompt handed to the agent. When the inbound message carried
 * images, append a note with their local paths so the agent reads them with
 * `image_analyze` (the vision tool accepts local `imagePaths`). An
 * image-only message becomes just the note.
 */
export function buildAgentPrompt(msg: InboundMessage): string {
  const text = msg.text.trim();
  if (!msg.imagePaths?.length) return text;

  const list = msg.imagePaths.map((path) => `- ${path}`).join('\n');
  const note =
    `[The user attached ${msg.imagePaths.length} image(s), saved locally at the path(s) below. ` +
    `To view or analyze them, call image_analyze with these imagePaths:\n${list}]`;
  return text ? `${text}\n\n${note}` : note;
}

