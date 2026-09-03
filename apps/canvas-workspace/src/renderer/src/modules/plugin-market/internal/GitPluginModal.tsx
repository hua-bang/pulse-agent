import { useEffect, useState } from 'react';
import { GitBranch, X } from '@phosphor-icons/react';
import type { PluginMarketSource } from '../../../../../shared/plugin-market';
import { Button, Modal, TextField } from '../../../components/ui';
import { useI18n } from '../../../i18n';
import { pluginMarketKeys as keys } from './i18nKeys';

interface Props {
  open: boolean;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (source: PluginMarketSource) => Promise<boolean>;
}

export const GitPluginModal = ({ open, busy, error, onClose, onSubmit }: Props) => {
  const { t } = useI18n();
  const [url, setUrl] = useState('');
  const [ref, setRef] = useState('');
  const [subdir, setSubdir] = useState('');
  const [validationError, setValidationError] = useState(false);

  useEffect(() => {
    if (!open) return;
    setUrl('');
    setRef('');
    setSubdir('');
    setValidationError(false);
  }, [open]);

  const submit = async () => {
    const cleanUrl = url.trim();
    if (!cleanUrl) {
      setValidationError(true);
      return;
    }
    const added = await onSubmit({
      kind: 'git',
      url: cleanUrl,
      ref: ref.trim() || undefined,
      subdir: subdir.trim() || undefined,
    });
    if (added) onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      width={540}
      labelledBy="plugin-market-git-title"
      className="plugin-market-modal"
    >
      <header className="plugin-market-modal__header">
        <div className="plugin-market-modal__heading">
          <span className="plugin-market-modal__icon"><GitBranch size={19} /></span>
          <div>
            <small>{t(keys.gitKicker)}</small>
            <h2 id="plugin-market-git-title">{t(keys.gitTitle)}</h2>
          </div>
        </div>
        <Button variant="icon" size="md" aria-label={t(keys.close)} onClick={onClose}>
          <X size={17} />
        </Button>
      </header>
      <div className="plugin-market-modal__body">
        <p className="plugin-market-modal__intro">{t(keys.gitDescription)}</p>
        <TextField
          autoFocus
          label={t(keys.gitUrl)}
          placeholder={t(keys.gitUrlPlaceholder)}
          value={url}
          aria-invalid={validationError}
          hint={validationError ? t(keys.gitUrlRequired) : undefined}
          onChange={(event) => {
            setUrl(event.target.value);
            if (event.target.value.trim()) setValidationError(false);
          }}
        />
        <div className="plugin-market-modal__field-grid">
          <TextField
            label={t(keys.gitRef)}
            placeholder={t(keys.gitRefPlaceholder)}
            value={ref}
            onChange={(event) => setRef(event.target.value)}
          />
          <TextField
            label={t(keys.gitSubdir)}
            placeholder={t(keys.gitSubdirPlaceholder)}
            value={subdir}
            onChange={(event) => setSubdir(event.target.value)}
          />
        </div>
        {error && <div className="plugin-market-modal__error" role="alert">{error}</div>}
      </div>
      <footer className="plugin-market-modal__actions">
        <Button disabled={busy} onClick={onClose}>{t(keys.cancel)}</Button>
        <Button variant="primary" disabled={busy} onClick={() => void submit()}>
          {busy ? t(keys.adding) : t(keys.addRepository)}
        </Button>
      </footer>
    </Modal>
  );
};
