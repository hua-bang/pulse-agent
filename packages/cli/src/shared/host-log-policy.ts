import type { EngineLogEntry } from './log-sink.js';

type RenderLevel = 'log' | 'warn' | 'error';

interface HostLogPolicyOptions {
  render: (level: RenderLevel, message: string) => void;
  logFile: string;
  verbose?: boolean;
  isVerbose?: () => boolean;
}

interface ExtensionIssueCounts {
  mcp: number;
  skills: number;
  other: number;
}

export class HostLogPolicy {
  private readonly render: HostLogPolicyOptions['render'];
  private readonly logFile: string;
  private readonly verbose: boolean;
  private readonly isVerboseOverride?: () => boolean;
  private readonly seenWarnings = new Set<string>();
  private readonly startupIssues: ExtensionIssueCounts = { mcp: 0, skills: 0, other: 0 };
  private startup = true;

  constructor(options: HostLogPolicyOptions) {
    this.render = options.render;
    this.logFile = options.logFile;
    this.verbose = options.verbose ?? false;
    this.isVerboseOverride = options.isVerbose;
  }

  handle(entry: EngineLogEntry): void {
    if (this.isVerbose()) {
      this.render(entry.level, entry.text);
      return;
    }

    if (entry.level === 'error') {
      this.render('error', entry.text);
      return;
    }

    if (entry.level !== 'warn' || this.seenWarnings.has(entry.text)) {
      return;
    }
    this.seenWarnings.add(entry.text);

    if (this.startup && this.countExtensionIssue(entry.text)) {
      return;
    }

    this.render('warn', entry.text);
  }

  finishStartup(): void {
    if (!this.startup) {
      return;
    }
    this.startup = false;

    if (this.isVerbose()) {
      return;
    }

    const { mcp, skills, other } = this.startupIssues;
    const total = mcp + skills + other;
    if (total === 0) {
      return;
    }

    const groups = [
      mcp > 0 ? `MCP ${mcp}` : null,
      skills > 0 ? `Skills ${skills}` : null,
      other > 0 ? `Other ${other}` : null,
    ].filter((group): group is string => Boolean(group));
    this.render(
      'warn',
      `Extensions: ${total} ${total === 1 ? 'issue' : 'issues'} (${groups.join(', ')}). Check extension configuration; details: --verbose or ${this.logFile}`,
    );
  }

  private isVerbose(): boolean {
    return this.isVerboseOverride?.() ?? this.verbose;
  }

  private countExtensionIssue(text: string): boolean {
    if (/^\[MCP\]/.test(text)) {
      this.startupIssues.mcp += 1;
      return true;
    }
    if (/^\[Skills\]/.test(text) || /^(?:Skill file|Failed to (?:parse|read) skill file)\b/.test(text)) {
      this.startupIssues.skills += 1;
      return true;
    }
    if (/^\[PluginManager\]/.test(text)) {
      this.startupIssues.other += 1;
      return true;
    }
    return false;
  }
}

export function formatStartupFailure(error: unknown): string {
  const detail = error instanceof Error ? error.stack ?? error.message : String(error);
  return `Failed to start CLI: ${detail}`;
}
