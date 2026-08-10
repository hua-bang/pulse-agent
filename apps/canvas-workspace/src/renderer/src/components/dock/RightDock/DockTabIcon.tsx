import { Tabs } from '@phosphor-icons/react';
import { AppLogoIcon, NodeTypeIcon } from '../../icons';
import type { DockTabSwitcherItem } from './dock-tab-items';
import { LinkTabIcon } from './LinkTabIcon';

type Props = Pick<DockTabSwitcherItem, 'kind'> & {
  faviconUrl?: string | undefined;
};

/** One fixed icon slot shared by the tab strip and the All Tabs menu. */
export const DockTabIcon = ({ kind, faviconUrl }: Props) => {
  return (
    <span
      className={`right-dock__tab-icon right-dock__tab-icon--${kind}`}
      aria-hidden="true"
    >
      {kind === 'chat' ? (
        <AppLogoIcon size={14} />
      ) : kind === 'terminal' ? (
        <NodeTypeIcon type="terminal" size={14} />
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
