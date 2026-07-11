import { z } from 'zod';

const selectorSchema = {
  selector: z.string().min(1).describe('CSS selector that identifies the HTML element(s) to patch.'),
  all: z.boolean().optional().describe('Patch all matches. Defaults to the first match only.'),
};

export const htmlPatchOperationSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('setText'), ...selectorSchema, text: z.string() }),
  z.object({ op: z.literal('replaceInnerHTML'), ...selectorSchema, html: z.string() }),
  z.object({ op: z.literal('replaceOuterHTML'), ...selectorSchema, html: z.string() }),
  z.object({ op: z.literal('insertHTML'), ...selectorSchema, position: z.enum(['beforebegin', 'afterbegin', 'beforeend', 'afterend']), html: z.string() }),
  z.object({ op: z.literal('remove'), ...selectorSchema }),
  z.object({ op: z.literal('setAttribute'), ...selectorSchema, name: z.string().min(1), value: z.string() }),
  z.object({ op: z.literal('removeAttribute'), ...selectorSchema, name: z.string().min(1) }),
  z.object({ op: z.literal('setCssProperty'), ...selectorSchema, property: z.string().min(1), value: z.string(), priority: z.enum(['important']).optional() }),
]);

export type HtmlPatchOperation = z.infer<typeof htmlPatchOperationSchema>;
export interface HtmlPatchAppliedOperation { op: HtmlPatchOperation['op']; selector: string; count: number }
export interface HtmlPatchResult { html: string; applied: HtmlPatchAppliedOperation[] }
