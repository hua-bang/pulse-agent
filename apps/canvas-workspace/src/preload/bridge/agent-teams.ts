import type { IpcRenderer } from 'electron';
import type { AgentTeamsApi } from '../../renderer/src/types';

export const createAgentTeamsApi = (ipcRenderer: IpcRenderer): AgentTeamsApi => ({
  create: (input) => ipcRenderer.invoke('agent-teams:create', input),
  list: (workspaceId) => ipcRenderer.invoke('agent-teams:list', { workspaceId }),
  snapshot: (workspaceId, teamId) => ipcRenderer.invoke('agent-teams:snapshot', { workspaceId, teamId }),
  addAgent: (input) => ipcRenderer.invoke('agent-teams:add-agent', input),
  briefLead: (workspaceId, teamId, content) =>
    ipcRenderer.invoke('agent-teams:brief-lead', { workspaceId, teamId, content }),
  confirmPlan: (workspaceId, teamId) =>
    ipcRenderer.invoke('agent-teams:confirm-plan', { workspaceId, teamId }),
  createTask: (input) => ipcRenderer.invoke('agent-teams:create-task', input),
  dispatch: (workspaceId, teamId) => ipcRenderer.invoke('agent-teams:dispatch', { workspaceId, teamId }),
  pause: (workspaceId, teamId) => ipcRenderer.invoke('agent-teams:pause', { workspaceId, teamId }),
  resume: (workspaceId, teamId) => ipcRenderer.invoke('agent-teams:resume', { workspaceId, teamId }),
  prepareAgentAutoResume: (workspaceId, teamId, agentId) =>
    ipcRenderer.invoke('agent-teams:prepare-agent-auto-resume', { workspaceId, teamId, agentId }),
  delete: (workspaceId, teamId) => ipcRenderer.invoke('agent-teams:delete', { workspaceId, teamId }),
  completeTask: (workspaceId, teamId, taskId, result) =>
    ipcRenderer.invoke('agent-teams:complete-task', { workspaceId, teamId, taskId, result }),
  openGate: (input) => ipcRenderer.invoke('agent-teams:open-gate', input),
  answerGate: (workspaceId, gateId, answer) =>
    ipcRenderer.invoke('agent-teams:answer-gate', { workspaceId, gateId, answer }),
  interruptAgent: (input) => ipcRenderer.invoke('agent-teams:interrupt-agent', input),
  sendInput: (workspaceId, teamId, agentId, content) =>
    ipcRenderer.invoke('agent-teams:send-input', { workspaceId, teamId, agentId, content }),
  reportAgentOutput: (workspaceId, nodeId, delta) =>
    ipcRenderer.invoke('agent-teams:agent-output', { workspaceId, nodeId, delta }),
  reportAgentExit: (workspaceId, nodeId, code) =>
    ipcRenderer.invoke('agent-teams:agent-exit', { workspaceId, nodeId, code }),
});
