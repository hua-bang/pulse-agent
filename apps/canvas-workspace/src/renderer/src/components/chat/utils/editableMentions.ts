export function appendMentionChipToEditable(
  element: HTMLElement,
  chip: HTMLElement,
): void {
  const lastChild = element.lastChild;
  const lastText = lastChild?.nodeType === Node.TEXT_NODE ? (lastChild.textContent ?? '') : '';
  if (element.childNodes.length > 0 && !lastText.endsWith(' ')) {
    element.appendChild(document.createTextNode(' '));
  }
  element.appendChild(chip);
  const spaceNode = document.createTextNode(' ');
  element.appendChild(spaceNode);

  const selection = window.getSelection();
  if (selection) {
    const range = document.createRange();
    range.setStartAfter(spaceNode);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  }
}
