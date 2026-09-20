import type { PageReading, PageSnapshot } from './types';

/** Capture limits describe saved observations, never model-context delivery. */
export class ReadingCapture {
  readonly value: PageReading = { entries: [], observations: 0, characters: 0, truncated: false };
  private readonly seen = new Set<string>();

  get full(): boolean {
    return this.value.entries.length >= 60 || this.value.characters >= 48_000;
  }

  add(snapshot: PageSnapshot, step: number): void {
    const reading = this.value;
    reading.observations++;
    reading.truncated ||= !!snapshot.textTruncated || snapshot.text.length > 6_000;
    const key = JSON.stringify([snapshot.url, snapshot.text]);
    if (!snapshot.text || this.seen.has(key)) return;
    if (this.full) { reading.truncated = true; return; }
    this.seen.add(key);
    const text = snapshot.text.slice(0, Math.min(6_000, 48_000 - reading.characters));
    reading.truncated ||= text.length < snapshot.text.length;
    reading.characters += text.length;
    reading.entries.push({ step, url: snapshot.url, title: snapshot.title, text,
      scrollUp: snapshot.scrollUp, scrollDown: snapshot.scrollDown, scrollAreas: snapshot.scrollAreas ?? [] });
  }
}

export function pageEvidence(page?: PageSnapshot) {
  return page ? { title: page.title, text: page.text.slice(0, 6_000),
    scroll: { top: page.scrollTop, height: page.viewportHeight, scrollHeight: page.scrollHeight,
      atTop: !page.scrollUp, atBottom: !page.scrollDown }, scrollAreas: page.scrollAreas ?? [] } : undefined;
}
