import { useI18n } from '../../i18n';
import { Button } from '../ui';
import type { RelayProgress } from '../../types';
import { roleColorSoft } from '../../utils/roleColors';

interface RelayBarProps {
  relay: RelayProgress;
  /** Graceful stop: the current speaker finishes, queued speakers are skipped. */
  onStop: () => void;
}

/**
 * Progress strip for a multi-role relay turn, shown above the composer while
 * several roles reply in sequence to one message.
 */
export const RelayBar = ({ relay, onStop }: RelayBarProps) => {
  const { t } = useI18n();
  const allDone = relay.speaking >= relay.total;

  return (
    <div className="chat-relay-bar" role="status">
      {relay.queue.map((role, index) => {
        const name = role?.name ?? 'AI';
        const color = role?.color;
        const done = index < relay.speaking;
        const speaking = index === relay.speaking && !allDone;
        return (
          <span
            key={`${role?.id ?? 'default'}-${index}`}
            className="chat-relay-step-group"
          >
            {index > 0 && <span className="chat-relay-arrow">→</span>}
            <span
              className={`chat-relay-step${done ? ' chat-relay-step--done' : ''}${speaking ? ' chat-relay-step--speaking' : ''}${role?.namedBy ? ' chat-relay-step--handoff' : ''}`}
              title={role?.namedBy ? t('roles.relayNamedBy', { name: role.namedBy }) : undefined}
              style={color && (done || speaking)
                ? { color, background: speaking ? roleColorSoft(color) : undefined }
                : undefined}
            >
              {speaking && <span className="chat-relay-dot" />}
              {name}
              {done && ' ✓'}
              {speaking && <span className="chat-relay-speaking-label">{t('roles.relaySpeaking')}</span>}
            </span>
          </span>
        );
      })}
      <Button
        variant="danger"
        size="xs"
        className="chat-relay-stop-btn"
        onClick={onStop}
        disabled={relay.stopping || allDone}
      >
        {relay.stopping ? t('roles.relayStopping') : t('roles.relayStop')}
      </Button>
    </div>
  );
};
