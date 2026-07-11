import { Window } from 'happy-dom';
import type { HtmlPatchAppliedOperation, HtmlPatchOperation, HtmlPatchResult } from './html-patch-schema';
export { htmlPatchOperationSchema } from './html-patch-schema';
export type { HtmlPatchAppliedOperation, HtmlPatchOperation, HtmlPatchResult } from './html-patch-schema';

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
