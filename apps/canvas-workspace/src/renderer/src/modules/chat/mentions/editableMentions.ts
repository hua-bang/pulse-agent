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

/** Appends plain text, separated by a space, and puts the caret after it. */
export function appendTextToEditable(element: HTMLElement, text: string): void {
  const lastChild = element.lastChild;
  const lastText = lastChild?.nodeType === Node.TEXT_NODE ? (lastChild.textContent ?? '') : '';
  const separator = element.childNodes.length > 0 && !lastText.endsWith(' ') ? ' ' : '';
  const textNode = document.createTextNode(`${separator}${text} `);
  element.appendChild(textNode);

  const selection = window.getSelection();
  if (selection) {
    const range = document.createRange();
    range.setStartAfter(textNode);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  }
}
