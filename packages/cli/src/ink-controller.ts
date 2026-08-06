import { buildProvider, CONTEXT_WINDOW_TOKENS, DEFAULT_MODEL, PulseAgent, type Context, type LLMProviderFactory, type PlanMode, type TaskListService } from 'pulse-coder-engine';

import { InputManager } from './input-manager.js';
import { memoryIntegration, buildMemoryRunContext, recordDailyLogFromSuccessPath } from './memory-integration.js';
import { SessionCommands } from './session-commands.js';
import { SkillCommands } from './skill-commands.js';
import type { TuiHelpItem } from './tui-renderer.js';
import { InkUiBridge } from './ink-ui-bridge.js';
import { formatRelativeTime, type InkCliController, type InkCliSnapshot, type CliInteractionMode } from './ink-app.js';
import type { EngineLogSink } from './log-sink.js';
import { createPulseCliTools } from './runtime-tools.js';
import { extractStepUsage } from './usage-metrics.js';
import { loadModelRegistry, parseModelSpec, resolveModelSpec, shortModelLabel, type ModelChoice } from './model-registry.js';
import { expandFileReferences, indexWorkspaceFiles } from './file-reference.js';

const LOCAL_COMMANDS = new Set([
  'help',
  'new',
  'resume',
  'sessions',
  'search',
  'rename',
  'delete',
  'clear',
  'compact',
  'skills',
  'wt',
  'status',
  'mode',
  'chat',
  'plan',
  'edit',
  'auto',
  'execute',
  'save',
  'tui',
  'debug',
  'model',
  'exit',
]);

/**
 * Commands removed from the surface. The implementations still exist so the
 * capability can be brought back, but they are unreachable from the CLI: both
 * were unmaintained (raw stdout writes tearing the Ink frame, no abort
 * support) and are superseded by sub-agents.
 */
const RETIRED_COMMANDS: Record<string, string> = {
  team: '/team is retired — use sub-agents instead.',
  teams: '/teams is retired — use sub-agents instead.',
  solo: '/solo is retired along with /teams.',
  acp: '/acp is retired — the CLI no longer proxies to external ACP agents.',
};

const HELP_ITEMS: TuiHelpItem[] = [
  { command: '/help', description: 'Show this help message' },
  { command: '/new [title]', description: 'Create a new session' },
  { command: '/resume [index|id-prefix|id]', description: 'Resume a session (bare /resume opens an interactive picker)' },
  { command: '/sessions [n]', description: 'List recent sessions (default 20)' },
  { command: '/search <query>', description: 'Search in saved sessions' },
  { command: '/rename <id> <new-title>', description: 'Rename a session' },
  { command: '/delete <id>', description: 'Delete a session' },
  { command: '/clear', description: 'Clear current conversation' },
  { command: '/compact', description: 'Force compact current conversation context' },
  { command: '/skills [list|<name|index> <message>]', description: 'Run one message with a selected skill' },
  { command: '/wt use <work-name>', description: 'Create a worktree + branch via worktree skill' },
  { command: '/status', description: 'Show current CLI/session status' },
  { command: '/mode [edit|plan]', description: 'Show or set CLI interaction mode' },
  { command: '/plan', description: 'Switch to planning mode (engine planning)' },
  { command: '/edit', description: 'Switch to edit mode (engine executing); /execute, /chat, /auto are aliases' },
  { command: '/save', description: 'Save current session explicitly' },
  { command: '/tui [status]', description: 'Show current Ink UI status' },
  { command: '/debug [on|off|tail <n>]', description: 'Engine log layer: toggle live display or tail the capture' },
  { command: '/model [id|claude:<id>|reset]', description: 'Show/switch model (bare = picker from .pulse-coder/models.json)' },
  { command: '/exit', description: 'Exit the application' },
];

const HELP_FOOTER = [
  'Enter - Send current input',
  'Ctrl+J - Insert a newline into the current draft',
  'Shift+Tab - Toggle CLI interaction mode (edit ↔ plan; maps to engine executing/planning)',
  'Tab - Complete the selected slash-command suggestion',
  'Type / - Show slash-command suggestions',
  '↑/↓ - Recall previous/next prompt (persisted across sessions)',
  '←/→, Ctrl+A/E - Move cursor',
  'Ctrl+U/K/W - Delete before cursor / after cursor / previous word',
  'Ctrl+O - Toggle tool-trace detail (one-line summaries ↔ content previews; affects new traces)',
  'Paste - Inserted literally (newlines included); bracketed paste supported',
  'Esc - Stop the current response, or clear the current draft when idle',
  'Ctrl+C - Press twice to save and exit (first press clears the draft)',
  'Scroll up - Finished output lives in the normal terminal scrollback',
];

class InkCoderController implements InkCliController {
  private readonly agent: PulseAgent;
  private readonly context: Context;
  private readonly sessionCommands: SessionCommands;
  private readonly inputManager: InputManager;
  private readonly skillCommands: SkillCommands;
  private readonly ui: InkUiBridge;
  private interactionMode: CliInteractionMode = 'edit';
  private readonly listeners = new Set<(snapshot: InkCliSnapshot) => void>();
  private currentAbortController: AbortController | null = null;
  private isProcessing = false;
  private isShuttingDown = false;
  private readonly queuedInputs: string[] = [];
  private lastContextTokens = 0;
  private totalOutputTokens = 0;
  private lastCachedTokens: number | undefined;
  private totalInputTokens = 0;
  private totalCachedTokens = 0;
  private readonly logSink: EngineLogSink | null;
  private debugLogs: boolean;
  private readonly seenWarnTexts = new Set<string>();
  private modelOverride: ModelChoice | null = null;
  private activePicker: 'session' | 'model' | null = null;
  private pickerModelChoices = new Map<string, ModelChoice>();

  constructor(options: { logSink?: EngineLogSink; verbose?: boolean; modelSpec?: string } = {}) {
    this.logSink = options.logSink ?? null;
    this.debugLogs = options.verbose ?? false;
    if (options.modelSpec) {
      this.modelOverride = parseModelSpec(options.modelSpec);
    }
    this.agent = new PulseAgent({
      enginePlugins: {
        plugins: [memoryIntegration.enginePlugin],
        dirs: ['.pulse-coder/engine-plugins', '.coder/engine-plugins', '~/.pulse-coder/engine-plugins', '~/.coder/engine-plugins'],
        scan: true
      },
      userConfigPlugins: {
        dirs: ['.pulse-coder/config', '.coder/config', '~/.pulse-coder/config', '~/.coder/config'],
        scan: true
      },
      tools: createPulseCliTools()
    });
    this.context = { messages: [] };
    this.ui = new InkUiBridge({
      onChange: snapshot => this.notify(snapshot),
    });
    this.ui.updateSnapshot({
      contextWindowTokens: this.currentContextWindow(),
      modelLabel: shortModelLabel(this.modelOverride?.model ?? DEFAULT_MODEL),
    });
    this.sessionCommands = new SessionCommands(message => this.ui.info(message ?? ''));
    this.inputManager = new InputManager({
      onRequest: request => this.ui.clarification(request),
    });
    this.skillCommands = new SkillCommands(this.agent, message => this.ui.info(message ?? ''));

    // Engine log layer policy: errors always surface as dim lines; warns
    // surface once per unique text per session (an SDK warning repeated on
    // every LLM call must not flood the transcript — the log file keeps all
    // occurrences). info/debug stay in the log file unless /debug (or
    // --verbose) is on.
    this.logSink?.subscribe(entry => {
      if (entry.level === 'error') {
        this.ui.log(`[error] ${entry.text}`);
        return;
      }
      if (entry.level === 'warn') {
        if (this.seenWarnTexts.has(entry.text)) {
          return;
        }
        this.seenWarnTexts.add(entry.text);
        this.ui.log(`[warn] ${entry.text}`);
        return;
      }
      if (this.debugLogs) {
        this.ui.log(entry.text);
      }
    });
  }

  async initialize(options: { continueLast?: boolean } = {}): Promise<void> {
    this.ui.showWelcome({ cwd: process.cwd() });
    await this.sessionCommands.initialize();
    await memoryIntegration.initialize();
    await this.agent.initialize();

    const pluginStatus = this.agent.getPluginStatus();
    this.ui.showPluginStatus(pluginStatus.enginePlugins.length);

    // Skills load with the engine, so publish them once initialization is done;
    // the composer merges them into the slash palette as `/<skill-name>`.
    const skills = this.skillCommands.listSkills();
    if (skills.length > 0) {
      this.ui.updateSnapshot({ skills: skills.map(skill => ({ name: skill.name, description: skill.description })) });
    }

    // Index the workspace in the background so `@` completion is ready without
    // delaying startup; a failure just leaves `@` with no suggestions.
    void indexWorkspaceFiles()
      .then(fileIndex => this.ui.updateSnapshot({ fileIndex }))
      .catch(() => undefined);

    if (options.continueLast && await this.sessionCommands.resumeLatest()) {
      await this.sessionCommands.loadContext(this.context);
    } else {
      await this.sessionCommands.createSession();
    }
    await this.syncSessionTaskListBinding();
    this.publishSession('Ready');
  }

  getSnapshot(): InkCliSnapshot {
    return this.ui.getSnapshot();
  }

  subscribe(listener: (snapshot: InkCliSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => this.listeners.delete(listener);
  }

  private applyInteractionMode(mode: CliInteractionMode, source = 'cli'): void {
    this.interactionMode = mode;

    // The status line and idle hint already reflect the mode — no transcript
    // event, or cycling with Shift+Tab would spam one line per press.
    const targetEngineMode: PlanMode = mode === 'plan' ? 'planning' : 'executing';
    if (this.agent.getMode() !== targetEngineMode && !this.agent.setMode(targetEngineMode, source)) {
      this.ui.warn('Engine plan-mode plugin unavailable; mode is CLI-side only.');
    }

    this.ui.updateSnapshot({ mode });
    this.publishSession('Ready');
  }

  setInteractionMode(mode: CliInteractionMode, source = 'cli'): void {
    this.applyInteractionMode(mode, source);
  }

  toggleToolDetail(): void {
    this.ui.setToolDetail(!this.ui.getToolDetail());
  }

  private currentContextWindow(): number {
    return this.modelOverride?.contextWindow ?? CONTEXT_WINDOW_TOKENS;
  }

  private describeConnection(choice: ModelChoice): string {
    if (choice.providerName) {
      return ` (provider ${choice.providerName})`;
    }
    return choice.modelType ? ` (${choice.modelType})` : '';
  }

  private applyModelOverride(note: string): void {
    this.ui.updateSnapshot({
      modelLabel: shortModelLabel(this.modelOverride?.model ?? DEFAULT_MODEL),
      contextWindowTokens: this.currentContextWindow(),
    });
    const keyEnv = this.modelOverride?.apiKeyEnv;
    if (keyEnv && !process.env[keyEnv]) {
      this.ui.log(`[warn] ${keyEnv} is not set — falling back to the channel's default API key env`);
    }
    this.ui.info(`${note} · ctx window ${Math.round(this.currentContextWindow() / 1000)}k · applies to new runs in this process`);
    this.publishSession('Ready');
  }

  /** Per-run overrides derived from the model choice; a provider-bound choice gets its own connection factory. */
  private modelRunOptions(): { model?: string; modelType?: 'openai' | 'claude'; contextWindowTokens?: number; provider?: LLMProviderFactory } {
    if (!this.modelOverride) {
      return {};
    }
    const needsCustomConnection = Boolean(this.modelOverride.baseUrl || this.modelOverride.apiKeyEnv);
    return {
      model: this.modelOverride.model,
      ...(this.modelOverride.modelType ? { modelType: this.modelOverride.modelType } : {}),
      ...(this.modelOverride.contextWindow ? { contextWindowTokens: this.modelOverride.contextWindow } : {}),
      ...(needsCustomConnection ? {
        provider: buildProvider(this.modelOverride.modelType ?? 'openai', {
          ...(this.modelOverride.baseUrl ? { baseURL: this.modelOverride.baseUrl } : {}),
          ...(this.modelOverride.apiKeyEnv && process.env[this.modelOverride.apiKeyEnv]
            ? { apiKey: process.env[this.modelOverride.apiKeyEnv] }
            : {}),
        }),
      } : {}),
    };
  }

  private async openModelPicker(): Promise<void> {
    const registry = await loadModelRegistry();
    registry.warnings.forEach(warning => this.ui.log(`[models.json] ${warning}`));
    const currentModel = this.modelOverride?.model ?? DEFAULT_MODEL;
    const seen = new Set<string>();
    this.pickerModelChoices = new Map();
    const items = [
      { id: DEFAULT_MODEL, label: shortModelLabel(DEFAULT_MODEL, 40), hint: 'env default', preview: DEFAULT_MODEL },
      ...registry.models.map(choice => {
        const id = `${choice.providerName ?? choice.modelType ?? ''}${choice.providerName || choice.modelType ? ':' : ''}${choice.model}`;
        this.pickerModelChoices.set(id, choice);
        return {
          id,
          label: choice.label ?? shortModelLabel(choice.model, 40),
          hint: `${choice.providerName ?? choice.modelType ?? 'default provider'}${choice.contextWindow ? ` · ${Math.round(choice.contextWindow / 1000)}k ctx` : ''}`,
          preview: choice.model,
        };
      }),
    ].filter(item => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });

    if (items.length <= 1) {
      this.ui.section('Model', [
        `Current: ${currentModel}${this.modelOverride ? ' (session override)' : ' (env default)'}`,
        'Switch directly: /model <id> · /model <provider>:<id> · /model claude:<id> · /model reset',
        'Add candidates + providers in .pulse-coder/models.json — see README §模型候选配置',
      ]);
      return;
    }

    this.activePicker = 'model';
    this.ui.showPicker({ title: 'Select model', items });
  }

  private async resumeSessionRef(ref: string): Promise<void> {
    if (await this.sessionCommands.resumeSession(ref)) {
      await this.sessionCommands.loadContext(this.context);
      await this.syncSessionTaskListBinding();
      this.publishSession('Session resumed');
    }
  }

  private async openSessionPicker(): Promise<void> {
    const sessions = await this.sessionCommands.listForPicker();
    if (sessions.length === 0) {
      this.ui.info('No previous sessions with messages. Use /sessions to list everything.');
      return;
    }

    this.activePicker = 'session';
    this.ui.showPicker({
      title: 'Resume session',
      items: sessions.map(session => ({
        id: session.id,
        label: session.title,
        hint: `${session.messageCount} msgs · ${formatRelativeTime(session.updatedAt)}`,
        preview: session.preview,
      })),
    });
  }

  pickerSelect(id: string): void {
    const kind = this.activePicker;
    this.activePicker = null;

    if (kind === 'model') {
      this.ui.hidePicker();
      const choice = this.pickerModelChoices.get(id) ?? parseModelSpec(id);
      this.pickerModelChoices = new Map();
      if (choice) {
        const isPlainDefault = choice.model === DEFAULT_MODEL && !choice.modelType && !choice.contextWindow && !choice.providerName;
        this.modelOverride = isPlainDefault ? null : choice;
        this.applyModelOverride(this.modelOverride
          ? `Model set: ${choice.model}${this.describeConnection(choice)}`
          : 'Model reset to env default');
      }
      return;
    }

    this.ui.hidePicker('Resuming session…');
    void this.resumeSessionRef(id);
  }

  pickerCancel(): void {
    this.activePicker = null;
    this.ui.hidePicker();
    this.publishSession('Ready');
  }

  requestStop(): void {
    // A clarification is requested from INSIDE a run, so isProcessing is true
    // while it is outstanding. It must therefore be cancelled independently of
    // the run — otherwise Esc aborts the run but leaves the request pending,
    // and the next message the user types is silently eaten as its answer.
    const hadPendingClarification = this.inputManager.hasPendingRequest();
    if (hadPendingClarification) {
      this.inputManager.cancel('User interrupted with Esc');
    }

    if (this.isProcessing) {
      if (this.currentAbortController && !this.currentAbortController.signal.aborted) {
        this.currentAbortController.abort();
        this.ui.abort(hadPendingClarification
          ? 'Clarification and request cancelled by Esc. You can type the next message now.'
          : 'Request cancelled by Esc. You can type the next message now.');
      } else {
        this.ui.abort('Cancellation already requested. Waiting for current step to finish...');
      }
      return;
    }

    if (hadPendingClarification) {
      this.ui.abort('Clarification cancelled.');
    }
  }

  async submitInput(input: string): Promise<void> {
    const trimmedInput = input.trim();

    if (this.inputManager.handleUserInput(trimmedInput)) {
      this.ui.user(trimmedInput || '(empty clarification response)');
      // Leave the clarification phase so the composer drops its waiting style.
      this.ui.updateSnapshot({ phase: this.isProcessing ? 'Running' : 'Idle' });
      this.publishSession('Clarification submitted');
      return;
    }

    if (this.isProcessing) {
      if (trimmedInput) {
        this.queuedInputs.push(trimmedInput);
        this.publishSession('Input queued');
        this.ui.queued(`Queued input #${this.queuedInputs.length}. It will run after the current step finishes.`);
      }
      return;
    }

    if (!trimmedInput) {
      return;
    }

    if (trimmedInput.toLowerCase() === 'exit') {
      await this.shutdown();
      return;
    }

    await this.handleInput(trimmedInput);
  }

  async shutdown(): Promise<void> {
    if (this.isShuttingDown) {
      return;
    }
    this.isShuttingDown = true;

    if (this.isProcessing && this.currentAbortController && !this.currentAbortController.signal.aborted) {
      this.currentAbortController.abort();
    }

    if (this.inputManager.hasPendingRequest()) {
      this.inputManager.cancel('User interrupted with Ctrl+C');
    }

    this.ui.info('Saving current session...');
    try {
      await this.sessionCommands.saveContext(this.context);
      this.ui.success('Goodbye!');
    } catch (error) {
      this.ui.error(`Error while shutting down: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async handleInput(input: string): Promise<void> {
    let messageInput = input;

    if (input.startsWith('//')) {
      this.ui.warn(`${RETIRED_COMMANDS.acp} The "//" ACP passthrough prefix is retired with it.`);
      return;
    }

    if (messageInput.startsWith('/')) {
      const commandLine = messageInput.substring(1);
      const parts = commandLine.split(/\s+/).filter(part => part.length > 0);

      if (parts.length === 0) {
        this.ui.warn('Please provide a command after "/"');
        return;
      }

      const command = parts[0];
      const args = parts.slice(1);
      const normalizedCommand = command.toLowerCase();

      const retiredNotice = RETIRED_COMMANDS[normalizedCommand];
      if (retiredNotice) {
        this.ui.warn(retiredNotice);
        return;
      }

      if (!LOCAL_COMMANDS.has(normalizedCommand)) {
        // Command resolution order: built-in > skill > error. Built-ins always
        // win so a skill named e.g. "status" cannot shadow /status.
        const skillMessage = this.resolveSkillCommand(command, args);
        if (skillMessage) {
          messageInput = skillMessage;
        } else {
          this.ui.warn(`Unknown command: /${command}`);
          this.ui.info('Type /help for commands, /skills list for skills');
          return;
        }
      }

      if (LOCAL_COMMANDS.has(normalizedCommand)) {
        if (normalizedCommand === 'skills') {
          const transformedMessage = await this.skillCommands.transformSkillsCommandToMessage(args);
          if (!transformedMessage) {
            return;
          }
          messageInput = transformedMessage;
        } else if (normalizedCommand === 'wt') {
          if (args.length < 2 || args[0].toLowerCase() !== 'use') {
            this.ui.error('Usage: /wt use <work-name>');
            return;
          }

          const workName = args.slice(1).join(' ').trim();
          if (!workName) {
            this.ui.error('Worktree name cannot be empty.');
            this.ui.info('Usage: /wt use <work-name>');
            return;
          }

          messageInput = `[use skill](worktree) new ${workName}`;
          this.ui.success('Worktree request prepared via skill: worktree');
        } else {
          await this.handleCommand(command, args);
          return;
        }
      }
    }

    await this.runMessage(messageInput);
  }

  /**
   * Resolves `/<skill-name> <message>` against the skill registry.
   * Returns the engine's one-shot skill message, or null when no skill matches.
   */
  private resolveSkillCommand(command: string, args: string[]): string | null {
    const skill = this.skillCommands.findSkill(command);
    if (!skill) {
      return null;
    }

    const message = args.join(' ').trim();
    if (!message) {
      this.ui.error(`Usage: /${skill.name} <message>`);
      this.ui.info(skill.description);
      return null;
    }

    return `[use skill](${skill.name}) ${message}`;
  }

  private async handleCommand(command: string, args: string[]): Promise<void> {
    try {
      switch (command.toLowerCase()) {
        case 'help':
          this.ui.showHelp(HELP_ITEMS, HELP_FOOTER);
          break;
        case 'new':
          await this.sessionCommands.createSession(args.join(' ') || undefined);
          this.context.messages = [];
          await this.syncSessionTaskListBinding();
          this.publishSession('New session created');
          break;
        case 'resume':
          if (args.length === 0) {
            await this.openSessionPicker();
            break;
          }
          await this.resumeSessionRef(args[0]);
          break;
        case 'sessions':
          await this.sessionCommands.listSessions(args[0] ? Number(args[0]) : undefined);
          break;
        case 'search':
          if (args.length === 0) {
            this.ui.error('Please provide a search query');
            this.ui.info('Usage: /search <query>');
            break;
          }
          await this.sessionCommands.searchSessions(args.join(' '));
          break;
        case 'rename':
          if (args.length < 2) {
            this.ui.error('Please provide session ID and new title');
            this.ui.info('Usage: /rename <session-id> <new-title>');
            break;
          }
          await this.sessionCommands.renameSession(args[0], args.slice(1).join(' '));
          break;
        case 'delete':
          if (args.length === 0) {
            this.ui.error('Please provide a session ID');
            this.ui.info('Usage: /delete <session-id>');
            break;
          }
          await this.sessionCommands.deleteSession(args[0]);
          this.publishSession('Session deleted');
          break;
        case 'clear':
          this.context.messages = [];
          this.ui.success('Current conversation cleared!');
          this.publishSession('Ready');
          break;
        case 'compact':
          await this.runExclusive(async () => this.compactContext());
          break;
        case 'skills':
          this.ui.info('Use /skills <name|index> <message> directly in input for one-shot skill execution.');
          break;
        case 'status':
          this.ui.section('CLI Status', [
            `Session: ${this.sessionCommands.getCurrentSessionId() || 'None (new session)'}`,
            `Model: ${this.modelOverride ? `${this.modelOverride.model}${this.describeConnection(this.modelOverride)} (session override)` : `${DEFAULT_MODEL} (env default)`}`,
            `Task List: ${this.sessionCommands.getCurrentTaskListId() || 'None'}`,
            `Messages: ${this.context.messages.length}`,
            `Context tokens: ${this.lastContextTokens > 0 ? `${this.lastContextTokens} (last run)` : `~${this.estimateTokens(this.context.messages)} (estimated)`}`,
            `Output tokens: ${this.totalOutputTokens} (this process)`,
            `Cache hit: ${this.describeCacheHit()}`,
            `CLI mode: ${this.interactionMode}`,
            `Engine plan mode: ${this.agent.getMode() || 'unavailable'}`,
            `Phase: ${this.getSnapshot().phase ?? 'Idle'}`,
            `Active tool: ${this.getSnapshot().activeTool ?? 'None'}`,
            `Tools: ${this.getSnapshot().completedTools}/${this.getSnapshot().toolCalls}`,
            `Queued inputs: ${this.queuedInputs.length}`,
            `Processing: ${this.isProcessing ? 'yes' : 'no'}`,
            `Engine logs: ${this.debugLogs ? 'shown live' : 'file only'} · ${this.logSink?.count() ?? 0} captured · /debug`,
            `Tool detail: ${this.ui.getToolDetail() ? 'preview (detailed)' : 'one-line summaries'} · Ctrl+O toggles`,
          ]);
          break;
        case 'mode': {
          const requestedMode = args[0]?.toLowerCase();
          const nextMode = this.parseInteractionMode(requestedMode);
          if (nextMode) {
            this.applyInteractionMode(nextMode, 'cli:/mode');
          } else {
            this.ui.section('CLI Mode', [
              `Current: ${this.interactionMode}`,
              `Engine plan mode: ${this.agent.getMode() || 'unavailable'}`,
              'Available: edit (engine executing), plan (engine planning)',
              'Shortcut: Shift+Tab toggles modes',
            ]);
          }
          break;
        }
        case 'plan':
          this.applyInteractionMode('plan', 'cli:/plan');
          break;
        case 'edit':
        case 'execute':
        case 'chat':
        case 'auto':
          if (command.toLowerCase() !== 'edit') {
            this.ui.info(`Modes are now edit|plan; /${command.toLowerCase()} maps to edit.`);
          }
          this.applyInteractionMode('edit', `cli:/${command.toLowerCase()}`);
          break;
        case 'tui':
          this.ui.showTuiStatus();
          break;
        case 'model': {
          const spec = args.join(' ').trim();
          if (!spec) {
            await this.openModelPicker();
            break;
          }
          if (spec.toLowerCase() === 'reset') {
            this.modelOverride = null;
            this.applyModelOverride('Model reset to env default');
            break;
          }
          const registry = await loadModelRegistry();
          registry.warnings.forEach(warning => this.ui.log(`[models.json] ${warning}`));
          const choice = resolveModelSpec(spec, registry);
          if (!choice) {
            this.ui.error('Usage: /model [<id> | <provider>:<id> | claude:<id> | openai:<id> | reset]');
            break;
          }
          this.modelOverride = choice;
          this.applyModelOverride(`Model set: ${choice.model}${this.describeConnection(choice)}`);
          break;
        }
        case 'debug': {
          if (!this.logSink) {
            this.ui.warn('Engine log capture is unavailable in this host.');
            break;
          }
          const action = (args[0] ?? 'status').toLowerCase();
          if (action === 'on') {
            this.debugLogs = true;
            this.ui.success('Engine logs shown live (dim lines). /debug off to hide again.');
          } else if (action === 'off') {
            this.debugLogs = false;
            this.ui.success('Engine logs hidden. Still captured to the log file; warn/error still surface.');
          } else if (action === 'tail') {
            const requested = Number(args[1] ?? 20);
            const limit = Math.min(Math.max(Number.isFinite(requested) ? Math.floor(requested) : 20, 1), 100);
            const entries = this.logSink.entries(limit);
            if (entries.length === 0) {
              this.ui.info('No engine logs captured yet.');
            } else {
              this.ui.section(`Engine logs · last ${entries.length}`, entries.map(entry => `[${entry.level}] ${entry.text.split('\n')[0]}`));
            }
          } else {
            this.ui.section('Engine log layer', [
              `Live display: ${this.debugLogs ? 'on' : 'off (warn/error always surface)'}`,
              `Captured this session: ${this.logSink.count()} entries`,
              `File: ${this.logSink.filePath}`,
              'Usage: /debug on | off | tail <n>',
            ]);
          }
          break;
        }
        case 'save':
          if (this.sessionCommands.getCurrentSessionId()) {
            await this.sessionCommands.saveContext(this.context);
            this.ui.success('Current session saved!');
          } else {
            this.ui.error('No active session. Create one with /new');
          }
          break;
        case 'exit':
          await this.shutdown();
          break;
        default:
          this.ui.warn(`Unknown command: ${command}`);
          this.ui.info('Type /help to see available commands');
      }
    } catch (error) {
      this.ui.error(`Error executing command: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private parseInteractionMode(value: string | undefined): CliInteractionMode | null {
    if (value === 'plan' || value === 'planning') {
      return 'plan';
    }
    if (value === 'edit' || value === 'execute' || value === 'executing' || value === 'chat' || value === 'auto') {
      return 'edit';
    }
    return null;
  }

  private async compactContext(): Promise<void> {
    if (this.context.messages.length === 0) {
      this.ui.info('Context is empty, nothing to compact.');
      return;
    }

    const beforeCount = this.context.messages.length;
    const beforeTokens = this.estimateTokens(this.context.messages);
    const keepLastTurns = this.getKeepLastTurns();
    const compactResult = await this.agent.compactContext(this.context, {
      force: true,
      ...this.modelRunOptions(),
      contextWindowTokens: this.currentContextWindow(),
      onStart: () => this.ui.updateSnapshot({ status: 'Compacting context…', phase: 'Compacting' }),
    });

    if (!compactResult.didCompact || !compactResult.newMessages) {
      this.ui.info('No compaction was applied.');
      this.ui.info(`Messages: ${beforeCount}, estimated tokens: ~${beforeTokens}, KEEP_LAST_TURNS=${keepLastTurns}`);
      return;
    }

    this.context.messages = compactResult.newMessages;
    await this.sessionCommands.saveContext(this.context);

    const afterCount = this.context.messages.length;
    const afterTokens = this.estimateTokens(this.context.messages);
    const tokenDelta = beforeTokens - afterTokens;
    const tokenDeltaText = tokenDelta >= 0 ? `-${tokenDelta}` : `+${Math.abs(tokenDelta)}`;
    const reasonSuffix = compactResult.reason ? ` (${compactResult.reason})` : '';

    this.ui.section(`Context compacted${reasonSuffix}`, [
      `Messages: ${beforeCount} -> ${afterCount}`,
      `Estimated tokens: ~${beforeTokens} -> ~${afterTokens} (${tokenDeltaText})`,
      `KEEP_LAST_TURNS=${keepLastTurns}`,
    ]);
    this.publishSession('Ready');
  }

  private async runExclusive(task: () => Promise<unknown>): Promise<void> {
    this.isProcessing = true;
    this.ui.startProcessing('Running command');
    try {
      await task();
      this.publishSession('Ready');
    } catch (error) {
      this.ui.error(`Command error: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.isProcessing = false;
      this.ui.stopProcessing();
    }
  }

  private async runMessage(rawInput: string): Promise<void> {
    // The transcript shows what the user typed; the model additionally gets the
    // contents of any @referenced files appended below it.
    this.ui.user(rawInput);

    const expansion = await expandFileReferences(rawInput);
    if (expansion.attached.length > 0) {
      this.ui.log(`Attached ${expansion.attached.length} reference${expansion.attached.length === 1 ? '' : 's'}: ${expansion.attached.join(', ')}`);
    }
    for (const skipped of expansion.skipped) {
      this.ui.log(`[warn] @${skipped.ref} skipped — ${skipped.reason}`);
    }
    const messageInput = expansion.text;

    this.ui.session({
      sessionId: this.sessionCommands.getCurrentSessionId(),
      taskListId: this.sessionCommands.getCurrentTaskListId(),
      messages: this.context.messages.length,
      estimatedTokens: this.estimateTokens(this.context.messages),
      mode: this.interactionMode,
    });

    if (this.context.messages.length === 0) {
      // Title from what the user typed, never from injected file contents.
      await this.sessionCommands.maybeAutoTitle(rawInput);
    }

    this.context.messages.push({
      role: 'user',
      content: messageInput,
    });

    this.ui.startProcessing('Running agent');

    const ac = new AbortController();
    this.currentAbortController = ac;
    this.isProcessing = true;

    let sawText = false;
    let toolCalls = 0;
    const runStartedAt = Date.now();

    try {
      await this.syncSessionTaskListBinding();
      const currentSessionId = this.resolveCurrentSessionId();

      const runAgent = async () => this.agent.run(this.context, {
        abortSignal: ac.signal,
        ...this.modelRunOptions(),
        onCompactionStart: () => {
          this.ui.log('Compacting context (summarizing older turns)…');
          this.ui.updateSnapshot({ status: 'Compacting context…', phase: 'Compacting' });
        },
        onText: (delta) => {
          sawText = true;
          this.ui.text(delta);
        },
        onToolInputStart: ({ id, toolName }) => {
          this.ui.toolInputStart(id, toolName);
        },
        onToolInputDelta: ({ id, delta }) => {
          this.ui.toolInputDelta(id, delta);
        },
        onToolInputEnd: ({ id }) => {
          this.ui.toolInputEnd(id);
        },
        onToolCall: (toolCall) => {
          toolCalls += 1;
          const input = this.getToolInput(toolCall);
          this.ui.toolCall(this.resolveToolName(toolCall), input, this.getToolCallId(toolCall));
        },
        onToolResult: (toolResult) => {
          const record = toolResult as Record<string, unknown>;
          this.ui.toolResult(this.resolveToolName(record), this.getToolOutput(record), this.getToolCallId(record));
        },
        onStepFinish: (step) => {
          this.recordStepUsage(step);
          this.ui.stepFinished(step.finishReason);
        },
        onClarificationRequest: async (request) => {
          return await this.inputManager.requestInput(request);
        },
        onCompacted: (newMessages, event) => {
          const beforeMessages = this.context.messages.length;
          const beforeTokens = this.estimateTokens(this.context.messages);
          this.context.messages = newMessages;
          const afterTokens = this.estimateTokens(newMessages);
          const reason = (event as { reason?: string } | undefined)?.reason;
          this.ui.info(`Context compacted · ${beforeMessages} → ${newMessages.length} messages · ~${beforeTokens} → ~${afterTokens} tokens${reason ? ` (${reason})` : ''}`);
          this.ui.updateSnapshot({ status: 'Running agent', phase: 'Running' });
        },
        onResponse: (messages) => {
          this.context.messages.push(...messages);
        },
      });

      const result = currentSessionId
        ? await memoryIntegration.withRunContext(
          buildMemoryRunContext({
            sessionId: currentSessionId,
            userText: messageInput,
          }),
          runAgent,
        )
        : await runAgent();

      this.ui.runSummary({
        elapsedMs: Date.now() - runStartedAt,
        toolCalls,
        messages: this.context.messages.length,
        estimatedTokens: this.estimateTokens(this.context.messages),
        mode: this.interactionMode,
      });

      if (result) {
        if (!sawText) {
          this.ui.plain(result);
        }

        await this.sessionCommands.saveContext(this.context);

        if (currentSessionId) {
          await recordDailyLogFromSuccessPath({
            sessionId: currentSessionId,
            userText: messageInput,
            assistantText: result,
          });
        }
      }
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        this.ui.abort('Operation cancelled.');
      } else {
        this.ui.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
      }
    } finally {
      this.isProcessing = false;
      this.currentAbortController = null;
      this.publishSession('Ready');

      if (this.queuedInputs.length > 0) {
        const nextInput = this.queuedInputs.shift();
        if (nextInput) {
          this.ui.info('Running queued input...');
          setImmediate(() => {
            void this.submitInput(nextInput);
          });
        }
      }
    }
  }

  private async syncSessionTaskListBinding(): Promise<void> {
    const taskListId = this.sessionCommands.getCurrentTaskListId();
    if (!taskListId) {
      return;
    }

    process.env.PULSE_CODER_TASK_LIST_ID = taskListId;

    const service = this.agent.getService<TaskListService>('taskListService');
    if (!service?.setTaskListId) {
      return;
    }

    try {
      const result = await service.setTaskListId(taskListId);
      if (result.switched) {
        this.ui.success(`Switched task list to ${result.taskListId}`);
      }
    } catch (error: any) {
      this.ui.warn(`Failed to switch task list binding: ${error?.message ?? String(error)}`);
    }
  }

  private resolveCurrentSessionId(): string | null {
    const currentId = this.sessionCommands.getCurrentSessionId();
    if (currentId) {
      return currentId;
    }

    this.ui.warn('No active session ID; memory tools and daily logs are skipped for this run.');
    return null;
  }

  private publishSession(status: string): void {
    this.ui.updateSnapshot({
      sessionId: this.sessionCommands.getCurrentSessionId(),
      taskListId: this.sessionCommands.getCurrentTaskListId(),
      messages: this.context.messages.length,
      estimatedTokens: this.estimateTokens(this.context.messages),
      mode: this.interactionMode,
      queuedInputs: this.queuedInputs.length,
      isProcessing: this.isProcessing,
      status,
      ...(status === 'Ready' && !this.isProcessing ? { phase: 'Idle', activeTool: null } : {}),
    });
  }

  private notify(snapshot: InkCliSnapshot): void {
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }

  private safeStringify(value: unknown): string {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  private estimateTokens(messages: Context['messages']): number {
    let totalChars = 0;

    for (const message of messages) {
      totalChars += message.role.length;
      if (typeof message.content === 'string') {
        totalChars += message.content.length;
      } else {
        totalChars += this.safeStringify(message.content).length;
      }
    }

    return Math.ceil(totalChars / 4);
  }

  private getKeepLastTurns(): number {
    const value = Number(process.env.KEEP_LAST_TURNS ?? 4);
    if (!Number.isFinite(value) || value <= 0) {
      return 4;
    }

    return Math.floor(value);
  }

  private getToolInput(toolCall: Record<string, unknown>): unknown {
    const input = (toolCall as { input?: unknown }).input;
    if (input !== undefined) {
      return input;
    }
    const args = (toolCall as { args?: unknown }).args;
    if (args !== undefined) {
      return args;
    }
    return undefined;
  }

  private getToolCallId(payload: Record<string, unknown>): string | undefined {
    const callId = (payload as { toolCallId?: unknown }).toolCallId;
    return typeof callId === 'string' && callId ? callId : undefined;
  }

  private getToolOutput(toolResult: Record<string, unknown>): unknown {
    const output = (toolResult as { output?: unknown }).output;
    if (output !== undefined) {
      return output;
    }
    const result = (toolResult as { result?: unknown }).result;
    if (result !== undefined) {
      return result;
    }
    return (toolResult as { content?: unknown }).content;
  }

  private recordStepUsage(step: unknown): void {
    const usage = extractStepUsage(step);

    if (usage.inputTokens !== undefined) {
      this.lastContextTokens = usage.inputTokens;
      this.totalInputTokens += usage.inputTokens;
    }
    if (usage.outputTokens !== undefined) {
      this.totalOutputTokens += usage.outputTokens;
    }
    if (usage.cachedInputTokens !== undefined) {
      this.lastCachedTokens = usage.cachedInputTokens;
      this.totalCachedTokens += usage.cachedInputTokens;
    }

    this.ui.usage({
      inputTokens: this.lastContextTokens,
      outputTokens: this.totalOutputTokens,
      cachedInputTokens: this.lastCachedTokens,
    });
  }

  private describeCacheHit(): string {
    if (this.lastCachedTokens === undefined) {
      return 'n/a (provider reports no cache usage)';
    }

    const lastPct = this.lastContextTokens > 0 ? Math.round(this.lastCachedTokens / this.lastContextTokens * 100) : 0;
    const sessionPct = this.totalInputTokens > 0 ? Math.round(this.totalCachedTokens / this.totalInputTokens * 100) : 0;
    return `last ${lastPct}% (${this.lastCachedTokens}/${this.lastContextTokens}) · session ${sessionPct}% (${this.totalCachedTokens}/${this.totalInputTokens})`;
  }

  private resolveToolName(payload: Record<string, unknown>): string {
    const name = (payload as { toolName?: unknown }).toolName
      ?? (payload as { name?: unknown }).name
      ?? (payload as { tool?: unknown }).tool
      ?? (payload as { title?: unknown }).title
      ?? (payload as { kind?: unknown }).kind;
    if (typeof name === 'string' && name.trim()) {
      return name;
    }
    const toolCallId = (payload as { toolCallId?: unknown }).toolCallId;
    if (typeof toolCallId === 'string' && toolCallId.trim()) {
      return toolCallId;
    }
    return 'tool';
  }
}

export interface CreateInkControllerOptions {
  continueLast?: boolean;
  verbose?: boolean;
  logSink?: EngineLogSink;
  modelSpec?: string;
}

export async function createInkCoderController(options: CreateInkControllerOptions = {}): Promise<InkCliController> {
  const controller = new InkCoderController({ logSink: options.logSink, verbose: options.verbose, modelSpec: options.modelSpec });
  await controller.initialize({ continueLast: options.continueLast });
  return controller;
}
