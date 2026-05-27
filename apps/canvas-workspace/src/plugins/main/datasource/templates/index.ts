/**
 * HTML template registry.
 *
 * Templates are server-rendered HTML documents that consume a datasource
 * via SSE. They live here as plain TS modules so adding a new template
 * is: drop a file, export a `TemplateDefinition`, add it below.
 *
 * Spec presentation `{ type: 'template', template: <id>, params }`
 * resolves to one of these entries; the template's `paramsSchema`
 * validates the LLM-provided params before render.
 */

import type { TemplateDefinition } from "./types";
import { bigNumberTemplate } from "./big-number";
import { lineChartTemplate } from "./line-chart";

export { wrapDocument, escapeHtml } from "./types";
export type { TemplateDefinition, TemplateRenderContext } from "./types";

export const templateRegistry: Record<string, TemplateDefinition> = {
  [bigNumberTemplate.id]: bigNumberTemplate as TemplateDefinition,
  [lineChartTemplate.id]: lineChartTemplate as TemplateDefinition,
};

/** Resolve a template by id; throws when unknown. */
export function getTemplate(id: string): TemplateDefinition {
  const t = templateRegistry[id];
  if (!t) {
    throw new Error(
      `unknown template "${id}". Available: ${Object.keys(templateRegistry).join(", ")}`,
    );
  }
  return t;
}

/** One-line list of available templates for the tool description. */
export function describeTemplates(): string {
  return Object.values(templateRegistry)
    .map((t) => `    ${t.id} — ${t.description}`)
    .join("\n");
}
