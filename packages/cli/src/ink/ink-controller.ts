import { DEFAULT_MODEL, PulseAgent, type Context, type PlanMode, type TaskListService } from 'pulse-coder-engine';
import { InputManager } from '../shared/input-manager.js';
import { goalIntegration } from '../shared/goal-integration.js';
import { memoryIntegration } from '../shared/memory-integration.js';
import { SessionCommands } from '../commands/session-commands.js';
import { SkillCommands } from '../commands/skill-commands.js';
import type { TuiHelpItem } from '../shared/tui-types.js';
import { InkUiBridge } from './ink-ui-bridge.js';
import { formatRelativeTime, truncateLabel, type InkCliController, type InkCliSnapshot, type CliInteractionMode } from './ink-app.js';
import type { EngineLogSink } from '../shared/log-sink.js';
import { createPulseCliTools } from '../tools/runtime-tools.js';
import { formatModelSpec, parseModelSpec, shortModelLabel, type ModelChoice } from '../models/model-spec.js';
import { PreferencesStore } from '../models/preferences.js';
import { indexWorkspaceFiles } from '../shared/file-reference.js';
import { applyModelOverride, currentContextWindow, describeConnection, resolveStartupModel, restoreSessionModel } from './controller-model.js';
import { pickerCancel as pickerCancelFn, pickerSelect as pickerSelectFn } from './controller-pickers.js';
import { dispatchInput, requestStop as requestStopFn, submitInput as submitInputFn } from './controller-dispatch.js';
import { drainQueuedInput as drainQueuedInputFn, runMessage as runMessageFn } from './controller-run.js';
import { publishSession, syncSessionGoalBinding, syncSessionTaskListBinding } from './controller-session.js';

export class InkCoderController implements InkCliController {
  readonly agent: PulseAgent;
  readonly context: Context;
  readonly sessionCommands: SessionCommands;
  readonly inputManager: InputManager;
  readonly skillCommands: SkillCommands;
  readonly ui: InkUiBridge;
  interactionMode: CliInteractionMode = 'edit';
  readonly listeners = new Set<(snapshot: InkCliSnapshot) => void>();
  currentAbortController: AbortController | null = null;
  isProcessing = false;
  isShuttingDown = false;
  readonly queuedInputs: string[] = [];
  /** A drain is already scheduled; nested finallys must not shift a second entry. */
  drainScheduled = false;
  lastContextTokens = 0;
  totalOutputTokens = 0;
  lastCachedTokens: number | undefined;
  totalInputTokens = 0;
  totalCachedTokens = 0;
  readonly logSink: EngineLogSink | null;
  debugLogs: boolean;
  readonly seenWarnTexts = new Set<string>();
  modelOverride: ModelChoice | null = null;
  activePicker: 'session' | 'model' | null = null;
  pickerModelChoices = new Map<string, ModelChoice>();
  readonly preferences = new PreferencesStore();
  /** A --model flag pins the model for this run and is never persisted. */
  readonly modelPinnedByFlag: boolean;

  constructor(options: { logSink?: EngineLogSink; verbose?: boolean; modelSpec?: string } = {}) {
    this.logSink = options.logSink ?? null;
    this.debugLogs = options.verbose ?? false;
    this.modelPinnedByFlag = Boolean(options.modelSpec);
    if (options.modelSpec) {
      this.modelOverride = parseModelSpec(options.modelSpec);
    }
    this.agent = new PulseAgent({
      enginePlugins: {
        plugins: [memoryIntegration.enginePlugin, goalIntegration.enginePlugin],
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
      contextWindowTokens: currentContextWindow(this),
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
    await goalIntegration.initialize();
    await this.agent.initialize();

    // Surface planning-mode tool rejections (hard-blocked mutating tools /
    // non-read-only bash commands) so the user knows why nothing happened.
    this.agent.events.on('disallowed_tool_attempt_in_planning', (event: any) => {
      const { toolName, category } = event?.payload ?? {};
      if (toolName) {
        this.ui.warn(`Planning mode blocked ${toolName}${category ? ` (${category})` : ''}`);
      }
    });

    const pluginStatus = this.agent.getPluginStatus();
    this.ui.showPluginStatus(pluginStatus.enginePlugins.length);

    await resolveStartupModel(this);

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
      await restoreSessionModel(this);
    } else {
      await this.sessionCommands.createSession();
    }
    await syncSessionTaskListBinding(this);
    await syncSessionGoalBinding(this);
    publishSession(this, 'Ready');
  }

  getSnapshot(): InkCliSnapshot {
    return this.ui.getSnapshot();
  }

  subscribe(listener: (snapshot: InkCliSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => this.listeners.delete(listener);
  }

  applyInteractionMode(mode: CliInteractionMode, source = 'cli'): void {
    this.interactionMode = mode;

    // The status line and idle hint already reflect the mode — no transcript
    // event, or cycling with Shift+Tab would spam one line per press.
    const targetEngineMode: PlanMode = mode === 'plan' ? 'planning' : 'executing';
    if (this.agent.getMode() !== targetEngineMode && !this.agent.setMode(targetEngineMode, source)) {
      this.ui.warn('Engine plan-mode plugin unavailable; mode is CLI-side only.');
    }

    this.ui.updateSnapshot({ mode });
    publishSession(this, 'Ready');
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
  async handleInput(input: string): Promise<void> {
    try {
      await dispatchInput(this, input);
    } finally {
      drainQueuedInputFn(this);
    }
  }

  /** One user message through the full turn pipeline (also exercised directly by tests). */
  runMessage(rawInput: string): Promise<void> {
    return runMessageFn(this, rawInput);
  }

  requestStop(): void {
    requestStopFn(this);
  }

  async submitInput(input: string): Promise<void> {
    await submitInputFn(this, input);
  }

  pickerSelect(id: string): void {
    pickerSelectFn(this, id);
  }

  pickerCancel(): void {
    pickerCancelFn(this);
  }

  drainQueuedInput(): void {
    drainQueuedInputFn(this);
  }

  notify(snapshot: InkCliSnapshot): void {
    for (const listener of this.listeners) {
      listener(snapshot);
    }
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
