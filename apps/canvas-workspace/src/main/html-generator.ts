/**
 * Lightweight one-shot LLM utility for generating HTML content.
 *
 * Used by the Link node's "AI" mode: the user types a prompt and this
 * module calls the configured LLM to produce a self-contained HTML page
 * that is then rendered in a sandboxed `<iframe srcdoc>`.
 *
 * This intentionally bypasses the full Canvas Agent / Engine session
 * machinery — no tools, no history, no streaming. Just prompt → HTML.
 */

import { generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';

const SYSTEM_PROMPT = `You are an expert HTML/CSS/JS developer. The user will describe a visual or interactive element they want.

Your job:
- Generate a **single, self-contained HTML document** that renders the requested content.
- Include all CSS and JavaScript inline (no external dependencies unless loaded via CDN).
- Use modern HTML5, CSS3, and vanilla JavaScript.
- Make it visually polished — use good typography, spacing, and color.
- If the user asks for charts/diagrams, use SVG or Canvas API (or a CDN library like Chart.js / D3 if needed).
- The HTML will be rendered inside a sandboxed iframe, so it must be fully self-contained.
- Respond with ONLY the raw HTML. No markdown fences, no explanation, no commentary.
- Start your response with <!DOCTYPE html> or <html>.`;

export async function generateHTML(prompt: string): Promise<{ ok: boolean; html?: string; error?: string }> {
  try {
    const openai = createOpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.OPENAI_API_URL,
    });

    const model = process.env.OPENAI_MODEL ?? 'gpt-4o';

    const { text } = await generateText({
      model: openai(model),
      system: SYSTEM_PROMPT,
      prompt,
    });

    // Strip markdown fences if the model wraps the HTML in ```html ... ```
    let html = text.trim();
    if (html.startsWith('```')) {
      html = html.replace(/^```(?:html)?\s*\n?/, '').replace(/\n?```\s*$/, '');
    }

    return { ok: true, html };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}
