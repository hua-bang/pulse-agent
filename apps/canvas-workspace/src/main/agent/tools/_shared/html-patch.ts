import { Window } from 'happy-dom';
import { z } from 'zod';

const selectorSchema = {
  selector: z.string().min(1).describe('CSS selector that identifies the HTML element(s) to patch.'),
  all: z.boolean().optional().describe('Patch all matches. Defaults to the first match only.'),
};

export const htmlPatchOperationSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('setText'),
    ...selectorSchema,
    text: z.string().describe('Plain text content. It is assigned via textContent, so HTML is escaped.'),
  }),
  z.object({
    op: z.literal('replaceInnerHTML'),
    ...selectorSchema,
    html: z.string().describe('Raw HTML that replaces the selected element innerHTML.'),
  }),
  z.object({
    op: z.literal('replaceOuterHTML'),
    ...selectorSchema,
    html: z.string().describe('Raw HTML that replaces the selected element itself.'),
  }),
  z.object({
    op: z.literal('insertHTML'),
    ...selectorSchema,
    position: z.enum(['beforebegin', 'afterbegin', 'beforeend', 'afterend']).describe('DOM insertAdjacentHTML position.'),
    html: z.string().describe('Raw HTML inserted at the requested position.'),
  }),
  z.object({
    op: z.literal('remove'),
    ...selectorSchema,
  }),
  z.object({
    op: z.literal('setAttribute'),
    ...selectorSchema,
    name: z.string().min(1).describe('Attribute name to set.'),
    value: z.string().describe('Attribute value to set.'),
  }),
  z.object({
    op: z.literal('removeAttribute'),
    ...selectorSchema,
    name: z.string().min(1).describe('Attribute name to remove.'),
  }),
  z.object({
    op: z.literal('setCssProperty'),
    ...selectorSchema,
    property: z.string().min(1).describe('CSS property name to set on the selected element inline style.'),
    value: z.string().describe('CSS property value.'),
    priority: z.enum(['important']).optional().describe('Set to important to write the declaration as !important.'),
  }),
]);

export type HtmlPatchOperation = z.infer<typeof htmlPatchOperationSchema>;

export interface HtmlPatchAppliedOperation {
  op: HtmlPatchOperation['op'];
  selector: string;
  count: number;
}

export interface HtmlPatchResult {
  html: string;
  applied: HtmlPatchAppliedOperation[];
}

type HappyDocument = InstanceType<typeof Window>['document'];
type HappyElement = ReturnType<HappyDocument['querySelectorAll']>[number];

function serializeDocument(document: HappyDocument): string {
  const doctype = document.doctype ? `<!DOCTYPE ${document.doctype.name}>` : '';
  const root = document.documentElement?.outerHTML ?? document.body.innerHTML;
  return doctype ? `${doctype}\n${root}` : root;
}

function isFullHtmlDocument(html: string): boolean {
  return /<!doctype\s+html|<html[\s>]/i.test(html);
}

function serializePatchedHtml(document: HappyDocument, sourceHtml: string): string {
  if (isFullHtmlDocument(sourceHtml)) {
    return serializeDocument(document);
  }
  return document.body.innerHTML;
}

function selectElements(document: HappyDocument, operation: HtmlPatchOperation): HappyElement[] {
  const matches = Array.from(document.querySelectorAll(operation.selector));
  if (matches.length === 0) {
    throw new Error(`Selector matched no elements: ${operation.selector}`);
  }
  return operation.all ? matches : matches.slice(0, 1);
}

function applyOperation(element: HappyElement, operation: HtmlPatchOperation): void {
  switch (operation.op) {
    case 'setText':
      element.textContent = operation.text;
      return;
    case 'replaceInnerHTML':
      element.innerHTML = operation.html;
      return;
    case 'replaceOuterHTML':
      element.outerHTML = operation.html;
      return;
    case 'insertHTML':
      element.insertAdjacentHTML(operation.position, operation.html);
      return;
    case 'remove':
      element.remove();
      return;
    case 'setAttribute':
      element.setAttribute(operation.name, operation.value);
      return;
    case 'removeAttribute':
      element.removeAttribute(operation.name);
      return;
    case 'setCssProperty':
      if (!(element instanceof element.ownerDocument.defaultView!.HTMLElement)) {
        throw new Error(`setCssProperty requires an HTMLElement target: ${operation.selector}`);
      }
      element.style.setProperty(operation.property, operation.value, operation.priority ?? '');
      return;
  }
}

export function patchHtmlContent(html: string, operations: HtmlPatchOperation[]): HtmlPatchResult {
  const window = new Window();
  try {
    const document = window.document;
    document.write(html);
    document.close();

    const applied: HtmlPatchAppliedOperation[] = [];
    for (const operation of operations) {
      let selected: HappyElement[];
      try {
        selected = selectElements(document, operation);
      } catch (err) {
        if (err instanceof Error && err.message.startsWith('Selector matched no elements:')) {
          throw err;
        }
        throw new Error(`Invalid selector "${operation.selector}": ${err instanceof Error ? err.message : String(err)}`);
      }
      for (const element of selected) {
        applyOperation(element, operation);
      }
      applied.push({ op: operation.op, selector: operation.selector, count: selected.length });
    }

    return { html: serializePatchedHtml(document, html), applied };
  } finally {
    window.close();
  }
}
