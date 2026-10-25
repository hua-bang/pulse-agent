import { useEffect, useState } from 'react';
import { FolderSimple, Globe } from '@phosphor-icons/react';
import type { CanvasConfigScope, CanvasSkillInput } from '../../../types';
import { useI18n } from '../../../i18n';
import { Button, Modal, SegmentedControl, TextField } from '../../../components/ui';

interface Props {
  open: boolean;
  initialScope: CanvasConfigScope;
  workspaceScope: Extract<CanvasConfigScope, { level: 'workspace' }>;
  onClose: () => void;
  onCreate: (scope: CanvasConfigScope, skill: CanvasSkillInput) => Promise<boolean>;
}

const EMPTY_SKILL: CanvasSkillInput = {
  name: '',
  description: '',
  body: '',
};

export const SkillEditorModal = ({
  open,
  initialScope,
  workspaceScope,
  onClose,
  onCreate,
}: Props) => {
  const { t } = useI18n();
  const [target, setTarget] = useState(initialScope.level);
  const [draft, setDraft] = useState<CanvasSkillInput>(EMPTY_SKILL);
  const [saving, setSaving] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTarget(initialScope.level);
    setDraft(EMPTY_SKILL);
    setConfirmDiscard(false);
  }, [initialScope.level, open]);

  const dirty = Boolean(draft.name.trim() || draft.description.trim() || draft.body.trim());

  // Esc, a backdrop press, and the × are easy to hit by accident, so they
  // never drop typed text silently: the first one asks, a second one
  // discards. The Cancel button is an explicit choice and closes at once.
  const requestClose = () => {
    if (!dirty || confirmDiscard) {
      onClose();
      return;
    }
    setConfirmDiscard(true);
  };

  const submit = async () => {
    if (!draft.name.trim() || !draft.description.trim()) return;
    setSaving(true);
    try {
      const created = await onCreate(
        target === 'global'
          ? { level: 'global' }
          : workspaceScope,
        draft,
      );
      if (created) onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={requestClose}
      width={520}
      labelledBy="skills-library-create-title"
      className="skills-library__modal"
    >
      <div className="skills-library__modal-header">
        <div>
          <span>{t('skillsLibrary.kicker')}</span>
          <h2 id="skills-library-create-title">{t('skillsLibrary.createTitle')}</h2>
        </div>
        <Button variant="icon" size="md" aria-label={t('skillsConfig.cancel')} onClick={requestClose}>
          ×
        </Button>
      </div>
      <div className="skills-library__modal-body">
        <TextField
          autoFocus
          label={t('skillsConfig.name')}
          placeholder={t('skillsConfig.namePlaceholder')}
          value={draft.name}
          onChange={(event) => setDraft({ ...draft, name: event.target.value })}
        />
        <TextField
          label={t('skillsConfig.description')}
          placeholder={t('skillsConfig.descriptionPlaceholder')}
          value={draft.description}
          onChange={(event) => setDraft({ ...draft, description: event.target.value })}
        />
        <TextField
          multiline
          rows={9}
          label={t('skillsConfig.body')}
          placeholder={t('skillsConfig.bodyPlaceholder')}
          value={draft.body}
          onChange={(event) => setDraft({ ...draft, body: event.target.value })}
        />
        <div className="skills-library__save-target">
          <span>{t('skillsLibrary.saveTo')}</span>
          <SegmentedControl
            value={target}
            onChange={(value) => setTarget(value as 'workspace' | 'global')}
            options={[
              {
                id: 'workspace',
                label: <><FolderSimple size={14} />{t('skillsLibrary.workspace')}</>,
              },
              {
                id: 'global',
                label: <><Globe size={14} />{t('skillsLibrary.global')}</>,
              },
            ]}
          />
        </div>
      </div>
      <div className="skills-library__modal-actions">
        {confirmDiscard && (
          <span className="skills-library__discard" role="status">
            {t('skillsLibrary.discardPrompt')}
          </span>
        )}
        <Button variant="secondary" onClick={onClose} disabled={saving}>
          {confirmDiscard ? t('skillsLibrary.discard') : t('skillsConfig.cancel')}
        </Button>
        <Button
          variant="primary"
          onClick={() => void submit()}
          disabled={saving || !draft.name.trim() || !draft.description.trim()}
        >
          {saving ? t('skillsConfig.saving') : t('skillsLibrary.create')}
        </Button>
      </div>
    </Modal>
  );
};
