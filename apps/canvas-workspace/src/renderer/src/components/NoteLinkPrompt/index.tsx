import { useEffect, useRef, useState } from 'react';
import './index.css';
import { useI18n } from '../../i18n';

interface Props {
  initial: string;
  onApply: (url: string) => void;
  onCancel: () => void;
}

export const NoteLinkPrompt = ({ initial, onApply, onCancel }: Props) => {
  const { t } = useI18n();
  const [value, setValue] = useState(initial);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onApply(value);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  };

  return (
    <div className="note-link-prompt" onMouseDown={(e) => e.stopPropagation()}>
      <input
        ref={inputRef}
        className="note-link-input"
        placeholder="https://example.com"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
      />
      <button className="note-link-action" onClick={() => onApply(value)} title={t('noteLink.applyTooltip')}>
        {t('noteLink.apply')}
      </button>
      {initial && (
        <button
          className="note-link-action note-link-action--danger"
          onClick={() => onApply('')}
          title={t('noteLink.removeTooltip')}
        >
          {t('noteLink.remove')}
        </button>
      )}
      <button className="note-link-close" onClick={onCancel} title={t('noteLink.cancelTooltip')}>
        ×
      </button>
    </div>
  );
};
