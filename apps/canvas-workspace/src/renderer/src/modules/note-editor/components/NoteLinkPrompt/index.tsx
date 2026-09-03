import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../../../../i18n';
import { isImeComposing } from '../../../../utils/ime';
import { Button } from '../../../../components/ui/Button';
import './index.css';

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
    if (isImeComposing(e)) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      onApply(value);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  };

  return (
    <div
      className="note-link-prompt"
      role="group"
      aria-label={t('noteLink.label')}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <input
        ref={inputRef}
        type="url"
        className="note-link-input"
        placeholder={t('noteLink.urlPlaceholder')}
        aria-label={t('noteLink.url')}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
      />
      <Button
        size="xs"
        className="note-link-action"
        onClick={() => onApply(value)}
        title={t('noteLink.applyHint')}
      >
        {t('noteLink.apply')}
      </Button>
      {initial && (
        <Button
          variant="danger"
          size="xs"
          className="note-link-action"
          onClick={() => onApply('')}
          title={t('noteLink.remove')}
        >
          {t('noteLink.remove')}
        </Button>
      )}
      <Button
        variant="icon"
        size="xs"
        className="note-link-close"
        onClick={onCancel}
        aria-label={t('noteLink.cancel')}
        title={t('noteLink.cancel')}
      >
        ×
      </Button>
    </div>
  );
};
