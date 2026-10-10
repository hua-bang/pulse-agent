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
  if (ref.htmlPreview) chip.dataset.domHtmlPreview = ref.htmlPreview;
  if (ref.tree) chip.dataset.domTree = JSON.stringify(ref.tree);
  if (ref.controls) chip.dataset.domControls = JSON.stringify(ref.controls);
  if (ref.accessibility) chip.dataset.domAccessibility = JSON.stringify(ref.accessibility);
  if (ref.snapshot) chip.dataset.domSnapshot = JSON.stringify(ref.snapshot);
  if (ref.rect) chip.dataset.domRect = JSON.stringify(ref.rect);
}

function parseDatasetJson<T>(value: string | undefined): T | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

export function readDomSelectionDataset(
  chip: HTMLElement,
  label: string,
  index: number,
): AgentContextDomSelectionRef | null {
  if (!chip.dataset.nodeId || !chip.dataset.domSelector) return null;
  const rect = parseDatasetJson<AgentContextDomSelectionRef['rect']>(chip.dataset.domRect);
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
    htmlPreview: chip.dataset.domHtmlPreview || undefined,
    tree: parseDatasetJson<AgentContextDomSelectionRef['tree']>(chip.dataset.domTree),
    controls: parseDatasetJson<AgentContextDomSelectionRef['controls']>(chip.dataset.domControls),
    accessibility: parseDatasetJson<AgentContextDomSelectionRef['accessibility']>(chip.dataset.domAccessibility),
    snapshot: parseDatasetJson<AgentContextDomSelectionRef['snapshot']>(chip.dataset.domSnapshot),
  };
}
