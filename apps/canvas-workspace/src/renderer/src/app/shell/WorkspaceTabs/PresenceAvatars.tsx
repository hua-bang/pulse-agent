import { Button } from '../../../components/ui/Button';
import { useI18n } from '../../../i18n';
import {
  peerToneForName,
  startFollowingPeer,
  stopFollowingPeer,
  useFollowingPeerId,
  useRemotePeers,
} from '../../../shared/remotePresence';

interface Props {
  workspaceId: string;
}

function peerInitial(name: string): string {
  const trimmed = name.trim();
  return trimmed ? Array.from(trimmed)[0].toUpperCase() : '?';
}

/** Stacked ambient presence avatars next to the Share pill; click to follow a peer's viewport. */
export const PresenceAvatars = ({ workspaceId }: Props) => {
  const { t } = useI18n();
  const peers = useRemotePeers(workspaceId);
  const followingId = useFollowingPeerId(workspaceId);

  if (peers.length === 0) return null;
  const visible = peers.slice(0, 3);
  const overflow = peers.length - visible.length;

  return (
    <div className="workspace-tabs__peers">
      {visible.map((peer) => {
        const isFollowing = followingId === peer.clientId;
        const label = isFollowing
          ? t('presence.following', { name: peer.name })
          : t('presence.clickToFollow', { name: peer.name });
        return (
          <Button
            key={peer.clientId}
            variant="icon"
            size="sm"
            className={`workspace-tabs__peer-avatar workspace-tabs__peer-avatar--${peerToneForName(peer.name)}${isFollowing ? ' is-following' : ''}`}
            title={label}
            aria-label={label}
            aria-pressed={isFollowing}
            onClick={() => {
              if (isFollowing) stopFollowingPeer(workspaceId);
              else startFollowingPeer(workspaceId, peer.clientId);
            }}
          >
            {peerInitial(peer.name)}
          </Button>
        );
      })}
      {overflow > 0 && (
        <span className="workspace-tabs__peer-overflow" aria-hidden="true">
          +{overflow}
        </span>
      )}
    </div>
  );
};
