import { PulseAgent } from 'pulse-coder-engine';
import * as readline from 'readline';
import type { Context } from 'pulse-coder-engine';
import { SessionCommands } from '../commands/session-commands.js';
import { InputManager } from '../shared/input-manager.js';
import { SkillCommands } from '../commands/skill-commands.js';
import { memoryIntegration } from '../shared/memory-integration.js';
import { goalIntegration } from '../shared/goal-integration.js';
import { TuiRenderer } from './tui-renderer.js';
import { formatModelSpec, type ModelChoice } from '../models/model-spec.js';
import { resolveModelChoice } from '../models/model-run-options.js';
import { createPulseCliTools } from '../tools/runtime-tools.js';
import type { ImageAttachment } from '../shared/file-reference.js';
import { executeAgentTurn } from './agent-turn.js';
import { routeSlashInput } from './command-surface.js';
import { ReadlineCommands } from './host-commands.js';
import { restoreSessionModel, syncSessionGoalBinding, syncSessionTaskListBinding } from './host-context.js';
import { EngineLogSink } from '../shared/log-sink.js';
import { HostLogPolicy } from '../shared/host-log-policy.js';

export class CoderCLI {
  agent: PulseAgent;
  context: Context;
  sessionCommands: SessionCommands;
  inputManager: InputManager;
  skillCommands: SkillCommands;
  tui: TuiRenderer;
  modelChoice: ModelChoice | null = null;
  readonly logSink: EngineLogSink;
  readonly logPolicy: HostLogPolicy;
  readonly verbose: boolean;
  startupComplete = false;
  private readonly commands: ReadlineCommands;

  constructor(readonly modelSpec?: string, options: { verbose?: boolean } = {}) {
    this.verbose = options.verbose ?? false;
    this.tui = new TuiRenderer();
    this.logSink = new EngineLogSink();
    this.logPolicy = new HostLogPolicy({
      logFile: this.logSink.filePath,
      verbose: this.verbose,
      render: (level, message) => this.renderLog(level, message),
    });
    this.logSink.install();
    this.logSink.subscribe(entry => this.logPolicy.handle(entry));

    // 🎯 现在引擎自动包含内置插件，无需显式配置！
    this.agent = new PulseAgent({
      enginePlugins: {
        plugins: [memoryIntegration.enginePlugin, goalIntegration.enginePlugin],
        // 只配置扩展插件目录，内置插件会自动加载
        dirs: ['.pulse-coder/engine-plugins', '.coder/engine-plugins', '~/.pulse-coder/engine-plugins', '~/.coder/engine-plugins'],
        scan: true
      },
      userConfigPlugins: {
        dirs: ['.pulse-coder/config', '.coder/config', '~/.pulse-coder/config', '~/.coder/config'],
        scan: true
      },
      tools: createPulseCliTools()
      // 注意：不再需要 plugins: [...] 配置
    });
    this.context = { messages: [] };
    this.sessionCommands = new SessionCommands(message => this.reportHostMessage('log', message ?? ''));
    // Mirrors the Ink host: saves record the active model so a resumed session
    // comes back on the model it was using.
    this.sessionCommands.setModelSpecProvider(() =>
      this.modelChoice ? formatModelSpec(this.modelChoice) : null);
    this.inputManager = new InputManager();
    this.skillCommands = new SkillCommands(this.agent);
    this.commands = new ReadlineCommands(this);
  }

  reportHostMessage(level: 'log' | 'warn' | 'error', message: string): void {
    if (!this.startupComplete) {
      this.logSink.record(level, [message]);
      return;
    }
    this.renderLog(level, message);
  }

  private renderLog(level: 'log' | 'warn' | 'error', message: string): void {
    if (level === 'error') {
      this.tui.error(message);
    } else if (level === 'warn') {
      this.tui.warn(message);
    } else {
      this.tui.info(message);
    }
  }

  async start(options: { continueLast?: boolean } = {}) {
    this.tui.showWelcome();

    // Resolve --model once, against the same merged home+project registry the Ink
    // host uses, so a provider-bound spec reaches the engine with its connection.
    this.modelChoice = await resolveModelChoice(this.modelSpec, warning => this.reportHostMessage('warn', warning));
    if (this.modelSpec && this.modelChoice) {
      this.reportHostMessage('log', `Model: ${formatModelSpec(this.modelChoice)}`);
    }

    await this.sessionCommands.initialize();
    await memoryIntegration.initialize();
    await goalIntegration.initialize();
    await this.agent.initialize();

    // Surface planning-mode tool rejections (hard-blocked mutating tools /
    // non-read-only bash commands) so the user knows why nothing happened.
    this.agent.events.on('disallowed_tool_attempt_in_planning', (event: any) => {
      const { toolName, category } = event?.payload ?? {};
      if (toolName) {
        this.tui.warn(`Planning mode blocked ${toolName}${category ? ` (${category})` : ''}`);
      }
    });

    const pluginStatus = this.agent.getPluginStatus();
    this.reportHostMessage('log', `Built-in plugins loaded: ${pluginStatus.enginePlugins.length} plugins`);

    // Resume the most recent session with --continue, otherwise auto-create one
    if (options.continueLast && await this.sessionCommands.resumeLatest()) {
      await this.sessionCommands.loadContext(this.context);
      await restoreSessionModel(this);
    } else {
      await this.sessionCommands.createSession();
    }
    await syncSessionTaskListBinding(this);
    await syncSessionGoalBinding(this);
    this.logPolicy.finishStartup();
    this.startupComplete = true;

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: this.tui.prompt()
    });

    let currentAbortController: AbortController | null = null;
    let isProcessing = false;
    const queuedInputs: string[] = [];

    readline.emitKeypressEvents(process.stdin);

    const requestStopCurrentRun = (): boolean => {
      if (isProcessing) {
        if (currentAbortController && !currentAbortController.signal.aborted) {
          currentAbortController.abort();
          this.tui.abort('Request cancelled by Esc. You can type the next message now.');
        } else {
          this.tui.abort('Cancellation already requested. Waiting for current step to finish...');
        }
        rl.prompt();
        return true;
      }

      if (this.inputManager.hasPendingRequest()) {
        this.inputManager.cancel('User interrupted with Esc');
        this.tui.abort('Clarification cancelled.');
        rl.prompt();
        return true;
      }

      return false;
    };

    const onKeypress = (_char: string, key: readline.Key) => {
      if (key?.name === 'escape') {
        requestStopCurrentRun();
      }
    };

    process.stdin.on('keypress', onKeypress);

    // Handle SIGINT/SIGTERM gracefully.
    //
    // This host runs the terminal in normal mode, so every Ctrl+C is a real
    // signal. Without the re-entrancy guard a second press (the natural reflex,
    // and the gesture the Ink host trains) starts a SECOND concurrent
    // saveContext against the same file, and whichever settles first calls
    // process.exit() without waiting for the other — killing the process
    // mid-write. saveSession is atomic now; this keeps the races out entirely.
    let isShuttingDown = false;
    const shutdown = () => {
      if (isShuttingDown) {
        return;
      }
      isShuttingDown = true;

      process.stdin.off('keypress', onKeypress);

      if (isProcessing && currentAbortController && !currentAbortController.signal.aborted) {
        currentAbortController.abort();
      }

      if (this.inputManager.hasPendingRequest()) {
        this.inputManager.cancel('User interrupted with Ctrl+C');
      }

      this.tui.info('Saving current session...');
      void this.sessionCommands.saveContext(this.context).finally(async () => {
        this.tui.success('Goodbye!');
        await this.logSink.restore().catch(() => {});
        process.exit(0);
      });
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    // Main input handler
    const handleInput = async (input: string) => {
      const trimmedInput = input.trim();

      // Handle clarification requests first. An empty answer to a request that
      // advertised "(Default: x)" means x — same rule as the Ink host, and the
      // substitution is echoed so the user sees what was sent.
      const clarificationAnswer = this.inputManager.resolveAnswer(trimmedInput);
      const substitutedDefault = !trimmedInput && clarificationAnswer;

      if (this.inputManager.handleUserInput(clarificationAnswer)) {
        if (substitutedDefault) {
          this.tui.info(`Using default answer: ${clarificationAnswer}`);
        }
        return;
      }

      if (isProcessing) {
        if (currentAbortController?.signal.aborted) {
          if (!trimmedInput) {
            rl.prompt();
            return;
          }

          queuedInputs.push(trimmedInput);
          this.tui.queued('Input queued. It will run right after the current step finishes.');
          rl.prompt();
          return;
        }

        this.tui.warn('Still processing. Press Esc to stop current request first.');
        rl.prompt();
        return;
      }

      if (trimmedInput.toLowerCase() === 'exit') {
        this.tui.info('Saving current session...');
        await this.sessionCommands.saveContext(this.context);
        this.tui.success('Goodbye!');
        rl.close();
        return;
      }

      if (!trimmedInput) {
        rl.prompt();
        return;
      }

      let messageInput = trimmedInput;
      let routeImages: ImageAttachment[] | undefined;

      if (trimmedInput.startsWith('/')) {
        const route = await routeSlashInput(this, this.commands, trimmedInput);
        if (route.kind === 'handled') {
          rl.prompt();
          return;
        }

        messageInput = route.message;
        routeImages = route.images;
      }

      const ac = new AbortController();
      currentAbortController = ac;
      isProcessing = true;

      try {
        await executeAgentTurn(this, messageInput, ac, routeImages);
      } finally {
        isProcessing = false;
        currentAbortController = null;

        if (queuedInputs.length > 0) {
          const nextInput = queuedInputs.shift();
          if (nextInput) {
            this.tui.info('Running queued input...');
            setImmediate(() => {
              void handleInput(nextInput);
            });
            return;
          }
        }

        rl.prompt();
      }
    };

    // Start the CLI
    rl.prompt();
    rl.on('line', handleInput);

    // Handle terminal close
    rl.on('close', async () => {
      process.stdin.off('keypress', onKeypress);
      this.tui.info('Saving current session...');
      await this.sessionCommands.saveContext(this.context);
      this.tui.success('Goodbye!');
      await this.logSink.restore();
      process.exit(0);
    });
  }
}
