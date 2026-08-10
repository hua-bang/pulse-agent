import { DEFAULT_MODEL } from 'pulse-coder-engine';
import type { InkCoderController } from './ink-controller.js';
import { estimateTokens, getKeepLastTurns, publishSession, resetUsageCounters, syncSessionTaskListBinding } from './controller-session.js';
import type { CliInteractionMode } from './ink-app.js';
import { HELP_FOOTER, HELP_ITEMS } from './controller-defs.js';
import { applyModelOverride, currentContextWindow, describeConnection, modelRunOptions, restoreSessionModel } from './controller-model.js';
import { openModelPicker, openSessionPicker, resumeSessionRef } from './controller-pickers.js';
import { describeCacheHit, runExclusive } from './controller-run.js';
import { formatModelSpec, resolveModelSpec } from '../models/model-spec.js';
import { loadModelRegistry } from '../models/model-registry.js';

/** Slash-command handlers for the Ink host. */

export async function handleCommand(controller: InkCoderController, command: string, args: string[]): Promise<void> {
  try {
    switch (command.toLowerCase()) {
      case 'help':
        controller.ui.showHelp(HELP_ITEMS, HELP_FOOTER);
        break;
      case 'new':
        await controller.sessionCommands.createSession(args.join(' ') || undefined);
        controller.context.messages = [];
        resetUsageCounters(controller);
        await syncSessionTaskListBinding(controller);
        publishSession(controller, 'New session created');
        break;
      case 'resume':
        if (args.length === 0) {
          await openSessionPicker(controller);
          break;
        }
        await resumeSessionRef(controller, args[0]);
        break;
      case 'sessions':
        {
          const allDirectories = args.some(arg => arg === '--all' || arg === '-a');
          const countArg = args.find(arg => /^\d+$/.test(arg));
          await controller.sessionCommands.listSessions(countArg ? Number(countArg) : undefined, { allDirectories });
        }
        break;
      case 'search':
        if (args.length === 0) {
          controller.ui.error('Please provide a search query');
          controller.ui.info('Usage: /search <query>');
          break;
        }
        await controller.sessionCommands.searchSessions(args.join(' '));
        break;
      case 'rename':
        if (args.length < 2) {
          controller.ui.error('Please provide session ID and new title');
          controller.ui.info('Usage: /rename <session-id> <new-title>');
          break;
        }
        await controller.sessionCommands.renameSession(args[0], args.slice(1).join(' '));
        break;
      case 'delete':
        if (args.length === 0) {
          controller.ui.error('Please provide a session ID');
          controller.ui.info('Usage: /delete <session-id>');
          break;
        }
        {
          const activeId = controller.sessionCommands.getCurrentSessionId();
          const deleted = await controller.sessionCommands.deleteSession(args[0]);
          // Deleting the ACTIVE session must also drop its in-memory context,
          // or the conversation keeps running and silently cannot be saved.
          if (deleted && activeId && !controller.sessionCommands.getCurrentSessionId()) {
            controller.context.messages = [];
            resetUsageCounters(controller);
            controller.ui.warn('Deleted the active session; its conversation was cleared. Use /new to start another.');
          }
        }
        publishSession(controller, 'Session deleted');
        break;
      case 'clear':
        controller.context.messages = [];
        resetUsageCounters(controller);
        controller.ui.success('Current conversation cleared!');
        publishSession(controller, 'Ready');
        break;
      case 'compact':
        await runExclusive(controller, async () => compactContext(controller));
        break;
      case 'skills':
        controller.ui.info('Use /skills <name|index> <message> directly in input for one-shot skill execution.');
        break;
      case 'status':
        controller.ui.section('CLI Status', [
          `Session: ${controller.sessionCommands.getCurrentSessionId() || 'None (new session)'}`,
          `Model: ${controller.modelOverride ? `${controller.modelOverride.model}${describeConnection(controller, controller.modelOverride)} (session override)` : `${DEFAULT_MODEL} (env default)`}`,
          `Task List: ${controller.sessionCommands.getCurrentTaskListId() || 'None'}`,
          `Messages: ${controller.context.messages.length}`,
          `Context tokens: ${controller.lastContextTokens > 0 ? `${controller.lastContextTokens} (last run)` : `~${estimateTokens(controller, controller.context.messages)} (estimated)`}`,
          `Output tokens: ${controller.totalOutputTokens} (this process)`,
          `Cache hit: ${describeCacheHit(controller)}`,
          `CLI mode: ${controller.interactionMode}`,
          `Engine plan mode: ${controller.agent.getMode() || 'unavailable'}`,
          `Phase: ${controller.getSnapshot().phase ?? 'Idle'}`,
          `Active tool: ${controller.getSnapshot().activeTool ?? 'None'}`,
          `Tools: ${controller.getSnapshot().completedTools}/${controller.getSnapshot().toolCalls}`,
          `Queued inputs: ${controller.queuedInputs.length}`,
          `Processing: ${controller.isProcessing ? 'yes' : 'no'}`,
          `Engine logs: ${controller.debugLogs ? 'shown live' : 'file only'} · ${controller.logSink?.count() ?? 0} captured · /debug`,
          `Tool detail: ${controller.ui.getToolDetail() ? 'preview (detailed)' : 'one-line summaries'} · Ctrl+O toggles`,
          `Narration folding: ${controller.ui.getNarrationCollapse() ? 'on (one-line summaries)' : 'off (full text)'} · Ctrl+T or /narration toggles`,
        ]);
        break;
      case 'mode': {
        const requestedMode = args[0]?.toLowerCase();
        const nextMode = parseInteractionMode(controller, requestedMode);
        if (nextMode) {
          controller.applyInteractionMode(nextMode, 'cli:/mode');
        } else {
          controller.ui.section('CLI Mode', [
            `Current: ${controller.interactionMode}`,
            `Engine plan mode: ${controller.agent.getMode() || 'unavailable'}`,
            'Available: edit (engine executing), plan (engine planning)',
            'Shortcut: Shift+Tab toggles modes',
          ]);
        }
        break;
      }
      case 'plan':
        controller.applyInteractionMode('plan', 'cli:/plan');
        break;
      case 'edit':
      case 'execute':
      case 'chat':
      case 'auto':
        if (command.toLowerCase() !== 'edit') {
          controller.ui.info(`Modes are now edit|plan; /${command.toLowerCase()} maps to edit.`);
        }
        controller.applyInteractionMode('edit', `cli:/${command.toLowerCase()}`);
        break;
      case 'tui':
        controller.ui.showTuiStatus();
        break;
      case 'model': {
        const spec = args.join(' ').trim();
        if (!spec) {
          await openModelPicker(controller);
          break;
        }
        if (spec.toLowerCase() === 'reset') {
          controller.modelOverride = null;
          applyModelOverride(controller, 'Model reset to env default', true);
          break;
        }
        const registry = await loadModelRegistry();
        registry.warnings.forEach(warning => controller.ui.log(`[models.json] ${warning}`));
        const choice = resolveModelSpec(spec, registry);
        if (!choice) {
          controller.ui.error('Usage: /model [<id> | <provider>:<id> | claude:<id> | openai:<id> | reset]');
          break;
        }
        controller.modelOverride = choice;
        applyModelOverride(controller, `Model set: ${choice.model}${describeConnection(controller, choice)}`, true);
        break;
      }
      case 'debug': {
        if (!controller.logSink) {
          controller.ui.warn('Engine log capture is unavailable in this host.');
          break;
        }
        const action = (args[0] ?? 'status').toLowerCase();
        if (action === 'on') {
          controller.debugLogs = true;
          controller.ui.success('Engine logs shown live (dim lines). /debug off to hide again.');
        } else if (action === 'off') {
          controller.debugLogs = false;
          controller.ui.success('Engine logs hidden. Still captured to the log file; warn/error still surface.');
        } else if (action === 'tail') {
          const requested = Number(args[1] ?? 20);
          const limit = Math.min(Math.max(Number.isFinite(requested) ? Math.floor(requested) : 20, 1), 100);
          const entries = controller.logSink.entries(limit);
          if (entries.length === 0) {
            controller.ui.info('No engine logs captured yet.');
          } else {
            controller.ui.section(`Engine logs · last ${entries.length}`, entries.map(entry => `[${entry.level}] ${entry.text.split('\n')[0]}`));
          }
        } else {
          controller.ui.section('Engine log layer', [
            `Live display: ${controller.debugLogs ? 'on' : 'off (warn/error always surface)'}`,
            `Captured this session: ${controller.logSink.count()} entries`,
            `File: ${controller.logSink.filePath}`,
            'Usage: /debug on | off | tail <n>',
          ]);
        }
        break;
      }
      case 'narration': {
        const action = args[0]?.toLowerCase();
        if (action === 'on') {
          controller.ui.setNarrationCollapse(true);
        } else if (action === 'off') {
          controller.ui.setNarrationCollapse(false);
        } else {
          controller.ui.section('Narration folding', [
            `Current: ${controller.ui.getNarrationCollapse() ? 'on (one-line summaries)' : 'off (full text, default)'}`,
            'Applies to FUTURE narration segments only — already-printed transcript lines never change.',
            'The final answer segment that ends a run is never folded.',
            'Usage: /narration on | off · shortcut: Ctrl+T',
          ]);
        }
        break;
      }
      case 'save':
        if (controller.sessionCommands.getCurrentSessionId()) {
          await controller.sessionCommands.saveContext(controller.context);
          controller.ui.success('Current session saved!');
        } else {
          controller.ui.error('No active session. Create one with /new');
        }
        break;
      case 'exit':
        await controller.shutdown();
        break;
      default:
        controller.ui.warn(`Unknown command: ${command}`);
        controller.ui.info('Type /help to see available commands');
    }
  } catch (error) {
    controller.ui.error(`Error executing command: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function parseInteractionMode(controller: InkCoderController, value: string | undefined): CliInteractionMode | null {
  if (value === 'plan' || value === 'planning') {
    return 'plan';
  }
  if (value === 'edit' || value === 'execute' || value === 'executing' || value === 'chat' || value === 'auto') {
    return 'edit';
  }
  return null;
}

export async function compactContext(controller: InkCoderController): Promise<void> {
  if (controller.context.messages.length === 0) {
    controller.ui.info('Context is empty, nothing to compact.');
    return;
  }

  const beforeCount = controller.context.messages.length;
  const beforeTokens = estimateTokens(controller, controller.context.messages);
  const keepLastTurns = getKeepLastTurns(controller);
  const compactResult = await controller.agent.compactContext(controller.context, {
    force: true,
    ...modelRunOptions(controller),
    contextWindowTokens: currentContextWindow(controller),
    onStart: () => controller.ui.updateSnapshot({ status: 'Compacting context…', phase: 'Compacting' }),
  });

  if (!compactResult.didCompact || !compactResult.newMessages) {
    controller.ui.info('No compaction was applied.');
    controller.ui.info(`Messages: ${beforeCount}, estimated tokens: ~${beforeTokens}, KEEP_LAST_TURNS=${keepLastTurns}`);
    return;
  }

  controller.context.messages = compactResult.newMessages;
  await controller.sessionCommands.saveContext(controller.context);

  const afterCount = controller.context.messages.length;
  const afterTokens = estimateTokens(controller, controller.context.messages);
  const tokenDelta = beforeTokens - afterTokens;
  const tokenDeltaText = tokenDelta >= 0 ? `-${tokenDelta}` : `+${Math.abs(tokenDelta)}`;
  const reasonSuffix = compactResult.reason ? ` (${compactResult.reason})` : '';

  controller.ui.section(`Context compacted${reasonSuffix}`, [
    `Messages: ${beforeCount} -> ${afterCount}`,
    `Estimated tokens: ~${beforeTokens} -> ~${afterTokens} (${tokenDeltaText})`,
    `KEEP_LAST_TURNS=${keepLastTurns}`,
  ]);
  publishSession(controller, 'Ready');
}
