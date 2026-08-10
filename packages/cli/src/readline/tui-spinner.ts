import { CYAN, DIM, SPINNER_FRAMES } from './tui-format.js';

export interface TuiSpinnerHooks {
  write(chunk: string): void;
  /** Clears the active status line (no-op in plain mode; the renderer guards). */
  clearLine(): void;
  color(value: string, code: string): string;
  now(): number;
}

/** Owns the animated status line: interval timer, frame index, and the
 *  "a status line is on screen" flag its owner must clear before printing. */
export class TuiSpinner {
  private timer: ReturnType<typeof setInterval> | null = null;
  private index = 0;
  private label = 'Processing';
  private startedAt = 0;
  private statusLineActive = false;

  constructor(private readonly hooks: TuiSpinnerHooks) {}

  start(label: string): void {
    this.stop();
    this.label = label;
    this.startedAt = this.hooks.now();
    this.index = 0;
    this.hooks.write('\n');
    this.render();
    this.timer = setInterval(() => this.render(), 120);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    if (this.statusLineActive) {
      this.hooks.clearLine();
      this.statusLineActive = false;
    }
  }

  private render(): void {
    const frame = SPINNER_FRAMES[this.index % SPINNER_FRAMES.length];
    this.index += 1;
    const elapsed = Math.max(0, Math.floor((this.hooks.now() - this.startedAt) / 1000));
    const line = `${this.hooks.color(frame, CYAN)} ${this.label} ${this.hooks.color(`${elapsed}s`, DIM)} ${this.hooks.color('Esc to stop', DIM)}`;
    this.hooks.clearLine();
    this.hooks.write(line);
    this.statusLineActive = true;
  }
}
