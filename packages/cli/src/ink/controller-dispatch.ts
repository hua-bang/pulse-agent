import type { InkCoderController } from './ink-controller.js';
import { publishSession } from './controller-session.js';
import { truncateLabel } from './ink-app.js';
import { LOCAL_COMMANDS, RETIRED_COMMANDS } from './controller-defs.js';
import { handleCommand } from './controller-commands.js';
import { runMessage } from './controller-run.js';

/** Slash-input routing for the Ink host: built-in > runtime skill > error. */

export async function dispatchInput(controller: InkCoderController, input: string): Promise<void> {
  let messageInput = input;

  if (input.startsWith('//')) {
    controller.ui.warn(`${RETIRED_COMMANDS.acp} The "//" ACP passthrough prefix is retired with it.`);
    return;
  }

  if (messageInput.startsWith('/')) {
    const commandLine = messageInput.substring(1);
    const parts = commandLine.split(/\s+/).filter(part => part.length > 0);

    if (parts.length === 0) {
      controller.ui.warn('Please provide a command after "/"');
      return;
    }

    const command = parts[0];
    const args = parts.slice(1);
    const normalizedCommand = command.toLowerCase();

    const retiredNotice = RETIRED_COMMANDS[normalizedCommand];
    if (retiredNotice) {
      controller.ui.warn(retiredNotice);
      return;
    }

    if (!LOCAL_COMMANDS.has(normalizedCommand)) {
      // Command resolution order: built-in > skill > error. Built-ins always
      // win so a skill named e.g. "status" cannot shadow /status.
      const skillMessage = resolveSkillCommand(controller, command, args);
      if (skillMessage) {
        messageInput = skillMessage;
      } else {
        controller.ui.warn(`Unknown command: /${command}`);
        controller.ui.info('Type /help for commands, /skills list for skills');
        return;
      }
    }

    if (LOCAL_COMMANDS.has(normalizedCommand)) {
      if (normalizedCommand === 'skills') {
        const transformedMessage = await controller.skillCommands.transformSkillsCommandToMessage(args);
        if (!transformedMessage) {
          return;
        }
        messageInput = transformedMessage;
      } else if (normalizedCommand === 'wt') {
        if (args.length < 2 || args[0].toLowerCase() !== 'use') {
          controller.ui.error('Usage: /wt use <work-name>');
          return;
        }

        const workName = args.slice(1).join(' ').trim();
        if (!workName) {
          controller.ui.error('Worktree name cannot be empty.');
          controller.ui.info('Usage: /wt use <work-name>');
          return;
        }

        messageInput = `[use skill](worktree) new ${workName}`;
        controller.ui.success('Worktree request prepared via skill: worktree');
      } else {
        await handleCommand(controller, command, args);
        return;
      }
    }
  }

  await runMessage(controller, messageInput);
}

/**
 * Resolves `/<skill-name> <message>` against the skill registry.
 * Returns the engine's one-shot skill message, or null when no skill matches.
 */
export function resolveSkillCommand(controller: InkCoderController, command: string, args: string[]): string | null {
  const skill = controller.skillCommands.findSkill(command);
  if (!skill) {
    return null;
  }

  const message = args.join(' ').trim();
  if (!message) {
    controller.ui.error(`Usage: /${skill.name} <message>`);
    controller.ui.info(skill.description);
    return null;
  }

  return `[use skill](${skill.name}) ${message}`;
}

export function requestStop(controller: InkCoderController): void {
  // A clarification is requested from INSIDE a run, so isProcessing is true
  // while it is outstanding. It must therefore be cancelled independently of
  // the run — otherwise Esc aborts the run but leaves the request pending,
  // and the next message the user types is silently eaten as its answer.
  const hadPendingClarification = controller.inputManager.hasPendingRequest();
  if (hadPendingClarification) {
    controller.inputManager.cancel('User interrupted with Esc');
  }

  // Anything queued behind the run was typed for a conversation the user is
  // now stopping. Draining it after the abort (which the run's finally does)
  // would fire it milliseconds after telling them the request was cancelled.
  const droppedQueued = controller.queuedInputs.length;
  controller.queuedInputs.length = 0;

  if (controller.isProcessing) {
    const dropped = droppedQueued > 0
      ? ` ${droppedQueued} queued message${droppedQueued === 1 ? '' : 's'} discarded.`
      : '';
    if (controller.currentAbortController && !controller.currentAbortController.signal.aborted) {
      controller.currentAbortController.abort();
      controller.ui.abort((hadPendingClarification
        ? 'Clarification and request cancelled by Esc. You can type the next message now.'
        : 'Request cancelled by Esc. You can type the next message now.') + dropped);
    } else if (controller.currentAbortController) {
      controller.ui.abort(`Cancellation already requested. Waiting for current step to finish...${dropped}`);
    } else {
      // runExclusive() commands (/compact) hold no abort controller, so there
      // is nothing to cancel — say that instead of claiming a cancellation the
      // user never got.
      controller.ui.abort(`This command cannot be interrupted; waiting for it to finish.${dropped}`);
    }
    if (droppedQueued > 0) {
      // Only the counter — publishSession() would restore isProcessing:true
      // and undo the cancelled state abort() just published.
      controller.ui.updateSnapshot({ queuedInputs: 0 });
    }
    return;
  }

  if (hadPendingClarification) {
    controller.ui.abort('Clarification cancelled.');
  }
}

export async function submitInput(controller: InkCoderController, input: string): Promise<void> {
  const trimmedInput = input.trim();

  // A clarification advertising "Default: yes" must SEND yes when the user
  // just presses Enter — the prompt is an offer, not decoration. Resolving
  // it here (rather than inside handleUserInput) keeps the echo honest: the
  // transcript shows the answer the engine actually received.
  const clarificationAnswer = controller.inputManager.resolveAnswer(trimmedInput);

  if (controller.inputManager.handleUserInput(clarificationAnswer)) {
    controller.ui.user(clarificationAnswer || '(empty clarification response)');
    // Leave the clarification phase so the composer drops its waiting style.
    controller.ui.updateSnapshot({ phase: controller.isProcessing ? 'Running' : 'Idle' });
    publishSession(controller, 'Clarification submitted');
    return;
  }

  if (controller.isProcessing) {
    if (trimmedInput) {
      controller.queuedInputs.push(trimmedInput);
      publishSession(controller, 'Input queued');
      // Content preview, not just the position: with only a number in the
      // transcript there is no way to tell what got queued behind a long
      // run apart from counting how many times Enter was pressed.
      controller.ui.queued(`Queued #${controller.queuedInputs.length} · ${truncateLabel(trimmedInput, 60)}`);
    }
    return;
  }

  if (!trimmedInput) {
    return;
  }

  if (trimmedInput.toLowerCase() === 'exit') {
    await controller.shutdown();
    return;
  }

  await controller.handleInput(trimmedInput);
}
