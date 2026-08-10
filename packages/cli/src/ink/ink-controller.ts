import { CONTEXT_WINDOW_TOKENS, DEFAULT_MODEL, PulseAgent, type Context, type PlanMode, type TaskListService } from 'pulse-coder-engine';

import { InputManager } from '../shared/input-manager.js';
import { memoryIntegration, buildMemoryRunContext, recordDailyLogFromSuccessPath } from '../shared/memory-integration.js';
import { SessionCommands } from '../commands/session-commands.js';
import { SkillCommands } from '../commands/skill-commands.js';
import type { TuiHelpItem } from '../readline/tui-renderer.js';
import { InkUiBridge } from './ink-ui-bridge.js';
import { formatRelativeTime, truncateLabel, type InkCliController, type InkCliSnapshot, type CliInteractionMode } from './ink-app.js';
import type { EngineLogSink } from '../shared/log-sink.js';
import { createPulseCliTools } from '../tools/runtime-tools.js';
import { extractStepUsage } from '../shared/usage-metrics.js';
import { loadModelRegistry } from '../models/model-registry.js';
import { findDefaultModel, formatModelSpec, parseModelSpec, resolveKnownModelSpec, resolveModelSpec, shortModelLabel, type ModelChoice } from '../models/model-spec.js';
import { buildModelRunOptions, type ModelRunOptions } from '../models/model-run-options.js';
import { PreferencesStore } from '../models/preferences.js';
import { expandFileReferences, indexWorkspaceFiles } from '../shared/file-reference.js';

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
  'narration',
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
  { command: '/sessions [n] [--all]', description: 'List recent sessions in this directory (default 20; --all for every directory)' },
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
  { command: '/narration [on|off]', description: 'Fold future narration segments to a one-line summary (default off); bare shows the current state' },
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
  'Ctrl+T - Toggle narration folding (/narration on|off does the same; affects new narration segments)',
  'Paste - Inserted literally (newlines included); bracketed paste supported',
  'Esc - Stop the current response, or clear the current draft when idle',
  'Ctrl+C - Press twice to save and exit (first press clears the draft)',
  'Scroll up - Finished output lives in the normal terminal scrollback',
];

/** Exported for tests only; production code goes through `createInkCoderController`. */
export class InkCoderController implements InkCliController {
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
  /** A drain is already scheduled; nested finallys must not shift a second entry. */
  private drainScheduled = false;
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
  private readonly preferences = new PreferencesStore();
  /** A --model flag pins the model for this run and is never persisted. */
  private readonly modelPinnedByFlag: boolean;

  constructor(options: { logSink?: EngineLogSink; verbose?: boolean; modelSpec?: string } = {}) {
    this.logSink = options.logSink ?? null;
    this.debugLogs = options.verbose ?? false;
    this.modelPinnedByFlag = Boolean(options.modelSpec);
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
    // Every session save records the model it ran under, so /resume can bring
    // the session back on that model instead of whatever was chosen since.
    this.sessionCommands.setModelSpecProvider(() =>
      this.modelOverride ? formatModelSpec(this.modelOverride) : null);
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

    await this.resolveStartupModel();

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
      await this.restoreSessionModel();
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
    if (this.isProcessing) {
      // Switching engine plan mode mid-run would apply to the in-flight request
      // and churn the status line; make the refusal explicit instead.
      this.ui.warn('Cannot switch mode while a run is in progress — press Esc first.');
      return;
    }
    this.applyInteractionMode(mode, source);
  }

  toggleToolDetail(): void {
    this.ui.setToolDetail(!this.ui.getToolDetail());
  }

  toggleNarrationCollapse(): void {
    this.ui.setNarrationCollapse(!this.ui.getNarrationCollapse());
  }

  /** Usage counters are per-conversation; /new, /clear and /resume must zero them. */
  private resetUsageCounters(): void {
    this.lastContextTokens = 0;
    this.totalOutputTokens = 0;
    this.lastCachedTokens = undefined;
    this.totalInputTokens = 0;
    this.totalCachedTokens = 0;
    this.ui.resetUsage();
  }

  /**
   * Model precedence at startup:
   *   1. --model flag (this run only)
   *   2. the last /model choice, persisted in ~/.pulse-coder/preferences.json
   *   3. a models.json entry marked "default": true
   *   4. the engine's env default (ANTHROPIC_MODEL / OPENAI_MODEL / …)
   */
  private async resolveStartupModel(): Promise<void> {
    const registry = await loadModelRegistry();
    registry.warnings.forEach(warning => this.ui.log(`[models.json] ${warning}`));

    if (this.modelPinnedByFlag) {
      // Re-resolve the flag against the registry so it picks up the entry's
      // provider connection and contextWindow, not just the bare id.
      if (this.modelOverride) {
        this.modelOverride = resolveModelSpec(formatModelSpec(this.modelOverride), registry) ?? this.modelOverride;
      }
      this.applyModelOverride(`Model pinned by --model: ${this.modelOverride?.model}`);
      return;
    }

    const preferences = await this.preferences.load();
    if (preferences.lastModel) {
      // Strict on purpose: a silent restore must not resurrect a spec whose
      // provider has since left models.json as a literal `provider:model` id.
      const restored = resolveKnownModelSpec(preferences.lastModel, registry);
      if (restored) {
        this.modelOverride = restored;
        this.applyModelOverride(`Model restored from last session: ${restored.model}`);
        return;
      }
      this.ui.log(`[warn] last model "${preferences.lastModel}" is no longer in models.json — using the default`);
    }

    const fallback = findDefaultModel(registry);
    if (fallback) {
      this.modelOverride = fallback;
      this.applyModelOverride(`Model from models.json default: ${fallback.model}`);
    }
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

  private applyModelOverride(note: string, persist = false): void {
    if (persist) {
      void this.preferences.update({ lastModel: this.modelOverride ? formatModelSpec(this.modelOverride) : null });
    }
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
  private modelRunOptions(): ModelRunOptions {
    // Session-anchored so opt-in providers get a stable prompt_cache_key:
    // /resume restores the session's key, /new and model switches change an
    // input and produce a fresh one.
    return buildModelRunOptions(this.modelOverride, process.env, {
      sessionId: this.sessionCommands.getCurrentSessionId(),
    });
  }

  private async openModelPicker(): Promise<void> {
    const registry = await loadModelRegistry();
    registry.warnings.forEach(warning => this.ui.log(`[models.json] ${warning}`));
    const currentModel = this.modelOverride?.model ?? DEFAULT_MODEL;
    const seen = new Set<string>();
    this.pickerModelChoices = new Map();
    const items = [
      {
        id: DEFAULT_MODEL,
        label: shortModelLabel(DEFAULT_MODEL, 40),
        hint: 'env default',
        preview: DEFAULT_MODEL,
        isCurrent: !this.modelOverride,
      },
      ...registry.models.map(choice => {
        const id = `${choice.providerName ?? choice.modelType ?? ''}${choice.providerName || choice.modelType ? ':' : ''}${choice.model}`;
        this.pickerModelChoices.set(id, choice);
        return {
          id,
          label: choice.label ?? shortModelLabel(choice.model, 40),
          hint: `${choice.providerName ?? choice.modelType ?? 'default provider'}${choice.contextWindow ? ` · ${Math.round(choice.contextWindow / 1000)}k ctx` : ''}`,
          preview: choice.model,
          // Marks the row the picker opens on — matching on the full spec, not
          // just the model id, so two providers serving the same id stay apart.
          isCurrent: Boolean(this.modelOverride) && formatModelSpec(choice) === formatModelSpec(this.modelOverride!),
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
      await this.restoreSessionModel();
      this.resetUsageCounters();
      await this.syncSessionTaskListBinding();
      this.publishSession('Session resumed');
    }
  }

  /**
   * Applies the model recorded in the just-loaded session, so a resumed
   * conversation continues on the model it was actually using. Silent restore:
   * it never overwrites the global last-model preference (that records
   * explicit choices only), and --model still pins the whole process.
   */
  private async restoreSessionModel(): Promise<void> {
    const spec = this.sessionCommands.getLoadedModelSpec();
    if (!spec || this.modelPinnedByFlag) {
      return;
    }
    if (this.modelOverride && formatModelSpec(this.modelOverride) === spec) {
      return;
    }

    const registry = await loadModelRegistry();
    const restored = resolveKnownModelSpec(spec, registry);
    if (!restored) {
      this.ui.log(`[warn] session model "${spec}" is no longer in models.json — keeping the current model`);
      return;
    }

    this.modelOverride = restored;
    this.applyModelOverride(`Model restored from session: ${restored.model}`);
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
          : 'Model reset to env default', true);
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

    // Anything queued behind the run was typed for a conversation the user is
    // now stopping. Draining it after the abort (which the run's finally does)
    // would fire it milliseconds after telling them the request was cancelled.
    const droppedQueued = this.queuedInputs.length;
    this.queuedInputs.length = 0;

    if (this.isProcessing) {
      const dropped = droppedQueued > 0
        ? ` ${droppedQueued} queued message${droppedQueued === 1 ? '' : 's'} discarded.`
        : '';
      if (this.currentAbortController && !this.currentAbortController.signal.aborted) {
        this.currentAbortController.abort();
        this.ui.abort((hadPendingClarification
          ? 'Clarification and request cancelled by Esc. You can type the next message now.'
          : 'Request cancelled by Esc. You can type the next message now.') + dropped);
      } else if (this.currentAbortController) {
        this.ui.abort(`Cancellation already requested. Waiting for current step to finish...${dropped}`);
      } else {
        // runExclusive() commands (/compact) hold no abort controller, so there
        // is nothing to cancel — say that instead of claiming a cancellation the
        // user never got.
        this.ui.abort(`This command cannot be interrupted; waiting for it to finish.${dropped}`);
      }
      if (droppedQueued > 0) {
        // Only the counter — publishSession() would restore isProcessing:true
        // and undo the cancelled state abort() just published.
        this.ui.updateSnapshot({ queuedInputs: 0 });
      }
      return;
    }

    if (hadPendingClarification) {
      this.ui.abort('Clarification cancelled.');
    }
  }

  async submitInput(input: string): Promise<void> {
    const trimmedInput = input.trim();

    // A clarification advertising "Default: yes" must SEND yes when the user
    // just presses Enter — the prompt is an offer, not decoration. Resolving
    // it here (rather than inside handleUserInput) keeps the echo honest: the
    // transcript shows the answer the engine actually received.
    const clarificationAnswer = this.inputManager.resolveAnswer(trimmedInput);

    if (this.inputManager.handleUserInput(clarificationAnswer)) {
      this.ui.user(clarificationAnswer || '(empty clarification response)');
      // Leave the clarification phase so the composer drops its waiting style.
      this.ui.updateSnapshot({ phase: this.isProcessing ? 'Running' : 'Idle' });
      this.publishSession('Clarification submitted');
      return;
    }

    if (this.isProcessing) {
      if (trimmedInput) {
        this.queuedInputs.push(trimmedInput);
        this.publishSession('Input queued');
        // Content preview, not just the position: with only a number in the
        // transcript there is no way to tell what got queued behind a long
        // run apart from counting how many times Enter was pressed.
        this.ui.queued(`Queued #${this.queuedInputs.length} · ${truncateLabel(trimmedInput, 60)}`);
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

  /**
   * Every dispatch path hands the queue on.
   *
   * Only `runMessage()` and `runExclusive()` (i.e. `/compact`) used to drain,
   * so anything queued behind a run that then drained a slash command was
   * stranded: the command returned, nothing drained, the status line kept
   * counting inputs nobody would run, and the next message the user typed
   * executed BEFORE the older queued ones. `drainQueuedInput()` is re-entrant
   * safe, so the inner drains those two already do simply win the race and
   * this one is a no-op.
   */
  private async handleInput(input: string): Promise<void> {
    try {
      await this.dispatchInput(input);
    } finally {
      this.drainQueuedInput();
    }
  }

  private async dispatchInput(input: string): Promise<void> {
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
          this.resetUsageCounters();
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
          {
            const allDirectories = args.some(arg => arg === '--all' || arg === '-a');
            const countArg = args.find(arg => /^\d+$/.test(arg));
            await this.sessionCommands.listSessions(countArg ? Number(countArg) : undefined, { allDirectories });
          }
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
          {
            const activeId = this.sessionCommands.getCurrentSessionId();
            const deleted = await this.sessionCommands.deleteSession(args[0]);
            // Deleting the ACTIVE session must also drop its in-memory context,
            // or the conversation keeps running and silently cannot be saved.
            if (deleted && activeId && !this.sessionCommands.getCurrentSessionId()) {
              this.context.messages = [];
              this.resetUsageCounters();
              this.ui.warn('Deleted the active session; its conversation was cleared. Use /new to start another.');
            }
          }
          this.publishSession('Session deleted');
          break;
        case 'clear':
          this.context.messages = [];
          this.resetUsageCounters();
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
            `Narration folding: ${this.ui.getNarrationCollapse() ? 'on (one-line summaries)' : 'off (full text)'} · Ctrl+T or /narration toggles`,
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
            this.applyModelOverride('Model reset to env default', true);
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
          this.applyModelOverride(`Model set: ${choice.model}${this.describeConnection(choice)}`, true);
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
        case 'narration': {
          const action = args[0]?.toLowerCase();
          if (action === 'on') {
            this.ui.setNarrationCollapse(true);
          } else if (action === 'off') {
            this.ui.setNarrationCollapse(false);
          } else {
            this.ui.section('Narration folding', [
              `Current: ${this.ui.getNarrationCollapse() ? 'on (one-line summaries)' : 'off (full text, default)'}`,
              'Applies to FUTURE narration segments only — already-printed transcript lines never change.',
              'The final answer segment that ends a run is never folded.',
              'Usage: /narration on | off · shortcut: Ctrl+T',
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
      this.drainQueuedInput();
    }
  }

  /**
   * Runs the next queued input, if any. Every path that finishes a piece of
   * work calls this — agent runs, exclusive commands, and command dispatch —
   * so anything typed while one was in flight runs next, in the order it was
   * typed, instead of waiting for the user to send another message.
   *
   * Nested callers are the normal case (a command's dispatch finally fires
   * right after `runExclusive`'s own finally), so the drain is guarded: while
   * one is scheduled the rest are no-ops. Without it both would shift an entry
   * and the second would land on an already-busy controller and re-queue it at
   * the BACK, reordering exactly what the queue exists to preserve.
   */
  private drainQueuedInput(): void {
    if (this.drainScheduled || this.isShuttingDown || this.queuedInputs.length === 0) {
      return;
    }

    this.drainScheduled = true;
    setImmediate(() => {
      this.drainScheduled = false;
      // Taken here, not at schedule time: Esc discards the queue, and an entry
      // already pulled out of it would run after the user was told it was
      // dropped.
      const nextInput = this.queuedInputs.shift();
      if (!nextInput) {
        return;
      }
      this.ui.info('Running queued input...');
      // The status line counts the queue, so it has to shrink with it — a
      // command dispatch does not otherwise publish a session snapshot.
      this.ui.updateSnapshot({ queuedInputs: this.queuedInputs.length });
      void this.submitInput(nextInput);
    });
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
        // Aborting does not stop the model mid-flight: the current step keeps
        // delivering text and tool events until it unwinds. Writing those to
        // the bridge after the user was told the request was cancelled puts
        // answer fragments and spinning tool lines under a Cancelled status,
        // so every streaming callback stops at the signal.
        onText: (delta) => {
          if (ac.signal.aborted) {
            return;
          }
          sawText = true;
          this.ui.text(delta);
        },
        onToolInputStart: ({ id, toolName }) => {
          if (ac.signal.aborted) {
            return;
          }
          this.ui.toolInputStart(id, toolName);
        },
        onToolInputDelta: ({ id, delta }) => {
          if (ac.signal.aborted) {
            return;
          }
          this.ui.toolInputDelta(id, delta);
        },
        onToolInputEnd: ({ id }) => {
          if (ac.signal.aborted) {
            return;
          }
          this.ui.toolInputEnd(id);
        },
        onToolCall: (toolCall) => {
          if (ac.signal.aborted) {
            return;
          }
          toolCalls += 1;
          const input = this.getToolInput(toolCall);
          this.ui.toolCall(this.resolveToolName(toolCall), input, this.getToolCallId(toolCall));
        },
        onToolResult: (toolResult) => {
          if (ac.signal.aborted) {
            return;
          }
          const record = toolResult as Record<string, unknown>;
          this.ui.toolResult(this.resolveToolName(record), this.getToolOutput(record), this.getToolCallId(record));
        },
        onStepFinish: (step) => {
          // Usage still counts: those tokens were spent whether or not the
          // answer they paid for is shown.
          this.recordStepUsage(step);
          if (ac.signal.aborted) {
            return;
          }
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

      // The engine does not throw on abort: once the signal fires, loop() returns
      // the plain sentinel string 'Request aborted.' as an ordinary result, so the
      // AbortError catch below never sees an engine-side cancellation. Without this
      // check the success path would finalize the partial answer as final, write a
      // "Done in Xs" summary, print the sentinel as the model's reply, and persist
      // the cancelled turn to the session and the daily log.
      if (ac.signal.aborted) {
        this.ui.abort('Operation cancelled.');
        return;
      }

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

      this.drainQueuedInput();
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
