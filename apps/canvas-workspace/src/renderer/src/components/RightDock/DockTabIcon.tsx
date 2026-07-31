import { Tabs } from '@phosphor-icons/react';
import { AgentIcon } from '../AgentNodeBody/AgentIcon';
import { AppLogoIcon, NodeTypeIcon } from '../icons';
import type { DockTabSwitcherItem } from './dock-tab-items';
import { LinkTabIcon } from './LinkTabIcon';

type Props = Pick<DockTabSwitcherItem, 'kind'> & {
  faviconUrl?: string | undefined;
  agentType?: string | undefined;
};

/** One fixed icon slot shared by the tab strip and the All Tabs menu. */
export const DockTabIcon = ({ kind, faviconUrl, agentType }: Props) => {
  const agentModifier = agentType === 'claude-code' || agentType === 'codex'
    ? ` right-dock__tab-icon--agent-${agentType}`
    : '';
  const modifier = kind === 'terminal' && agentType
    ? ` right-dock__tab-icon--agent${agentModifier}`
    : '';

  return (
    <span
      className={`right-dock__tab-icon right-dock__tab-icon--${kind}${modifier}`}
      aria-hidden="true"
    >
      {kind === 'chat' ? (
        <AppLogoIcon size={14} />
      ) : kind === 'terminal' ? (
        agentType
          ? <AgentIcon id={agentType} size={14} />
          : <NodeTypeIcon type="terminal" size={14} />
      ) : kind === 'link' ? (
        <LinkTabIcon faviconUrl={faviconUrl} />
      ) : kind === 'node-detail' ? (
        <Tabs size={14} weight="regular" />
      ) : (
        <span className={`right-dock__tab-dot right-dock__tab-dot--${kind}`} />
      )}
    </span>
  );
};
