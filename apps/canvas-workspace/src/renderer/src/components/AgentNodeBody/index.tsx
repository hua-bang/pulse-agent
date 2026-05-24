import './index.css';
import { NodeMentionPicker } from '../NodeMentionPicker';
import { AgentPicker } from './AgentPicker';
import { AgentRestart } from './AgentRestart';
import { AgentTerminal } from './AgentTerminal';
import type { AgentNodeBodyProps } from './types';
import { detectAgentView, useAgentNodeController } from './useAgentNodeController';

export { detectAgentView };

export const AgentNodeBody = ({
  node,
  getAllNodes,
  rootFolder,
  workspaceId,
  onUpdate,
  readOnly = false,
}: AgentNodeBodyProps) => {
  const controller = useAgentNodeController({
    node,
    getAllNodes,
    rootFolder,
    workspaceId,
    onUpdate,
    readOnly,
  });

  if (controller.viewMode === 'setup') {
    return (
      <AgentPicker
        selectedAgent={controller.selectedAgent}
        cwdInput={controller.cwdInput}
        promptInput={controller.promptInput}
        rootFolder={rootFolder}
        recentCwds={controller.recentCwds}
        onBack={controller.fromRestart ? controller.handleBackToRestart : undefined}
        onAgentChange={controller.setSelectedAgent}
        onCwdChange={controller.setCwdInput}
        onPromptChange={controller.setPromptInput}
        onPickFolder={controller.handlePickFolder}
        onLaunch={controller.handleLaunch}
      />
    );
  }

  if (controller.viewMode === 'restart') {
    return (
      <AgentRestart
        agentType={controller.data.agentType || 'claude-code'}
        cwd={controller.data.cwd}
        prompt={controller.data.lastInitPrompt}
        onRestart={controller.handleRestartSession}
        onEdit={controller.handleEditInit}
      />
    );
  }

  return (
    <>
      {!readOnly && controller.pickerOpen && (
        <NodeMentionPicker
          nodes={controller.visibleNodes}
          onSelect={controller.handleMentionSelect}
          onClose={controller.handleMentionClose}
        />
      )}
      <AgentTerminal
        containerRef={controller.containerRef}
        status={controller.status}
        agentType={controller.data.agentType || 'claude-code'}
        cwd={controller.data.cwd}
        loading={controller.loading}
      />
    </>
  );
};
