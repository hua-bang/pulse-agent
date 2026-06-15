import type { AgentContextDomSelectionRef } from '../../../types';

export function writeDomSelectionDataset(
  chip: HTMLElement,
  ref: AgentContextDomSelectionRef,
): void {
  chip.dataset.mentionKind = 'dom-selection';
  chip.dataset.domId = ref.id;
  chip.dataset.domLabel = ref.label;
  chip.dataset.nodeId = ref.nodeId;
  if (ref.workspaceId) chip.dataset.workspaceId = ref.workspaceId;
  if (ref.nodeTitle) chip.dataset.nodeTitle = ref.nodeTitle;
  if (ref.url) chip.dataset.domUrl = ref.url;
  chip.dataset.domSelector = ref.selector;
  if (ref.tagName) chip.dataset.domTagName = ref.tagName;
  if (ref.text) chip.dataset.domText = ref.text;
  if (ref.html) chip.dataset.domHtml = ref.html;
  if (ref.rect) chip.dataset.domRect = JSON.stringify(ref.rect);
}

export function readDomSelectionDataset(
  chip: HTMLElement,
  label: string,
  index: number,
): AgentContextDomSelectionRef | null {
  if (!chip.dataset.nodeId || !chip.dataset.domSelector) return null;
  let rect: AgentContextDomSelectionRef['rect'] | undefined;
  if (chip.dataset.domRect) {
    try {
      rect = JSON.parse(chip.dataset.domRect) as AgentContextDomSelectionRef['rect'];
    } catch {
      rect = undefined;
    }
  }
  return {
    id: chip.dataset.domId || `dom-${chip.dataset.nodeId}-${index}`,
    label: chip.dataset.domLabel || label || 'DOM selection',
    workspaceId: chip.dataset.workspaceId || undefined,
    nodeId: chip.dataset.nodeId,
    nodeTitle: chip.dataset.nodeTitle || undefined,
    url: chip.dataset.domUrl || undefined,
    selector: chip.dataset.domSelector,
    tagName: chip.dataset.domTagName || undefined,
    rect,
    text: chip.dataset.domText || undefined,
    html: chip.dataset.domHtml || undefined,
  };
}
