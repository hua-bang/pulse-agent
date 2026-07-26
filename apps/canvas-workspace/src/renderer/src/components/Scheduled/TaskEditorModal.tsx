import { useEffect, useState } from 'react';
import type { ScheduledTask, ScheduledTaskInput } from '../../../../shared/scheduled';
import { Button, Modal, Select, TextField } from '../ui';
import { useI18n } from '../../i18n';

const INTERVAL_OPTIONS = [
  { value: '30', labelKey: 'scheduled.interval.30m' },
  { value: '60', labelKey: 'scheduled.interval.1h' },
  { value: '360', labelKey: 'scheduled.interval.6h' },
  { value: '1440', labelKey: 'scheduled.interval.daily' },
  { value: '10080', labelKey: 'scheduled.interval.weekly' },
] as const;

interface Props {
  open: boolean;
  task?: ScheduledTask;
  onClose: () => void;
  onSave: (input: ScheduledTaskInput) => Promise<boolean>;
}

export const TaskEditorModal = ({ open, task, onClose, onSave }: Props) => {
  const { t } = useI18n();
  const [title, setTitle] = useState('');
  const [prompt, setPrompt] = useState('');
  const [interval, setIntervalValue] = useState('1440');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle(task?.title ?? '');
    setPrompt(task?.prompt ?? '');
    setIntervalValue(String(task?.intervalMinutes ?? 1440));
  }, [open, task]);

  const submit = async () => {
    if (!title.trim() || !prompt.trim() || saving) return;
    setSaving(true);
    try {
      const saved = await onSave({
        title: title.trim(),
        prompt: prompt.trim(),
        intervalMinutes: Number(interval),
        enabled: task?.enabled ?? true,
      });
      if (saved) onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      width={560}
      labelledBy="scheduled-editor-title"
      className="scheduled-editor"
    >
      <header className="scheduled-editor__header">
        <span>{t('scheduled.kicker')}</span>
        <h2 id="scheduled-editor-title">
          {task ? t('scheduled.editTask') : t('scheduled.createTask')}
        </h2>
      </header>
      <div className="scheduled-editor__body">
        <TextField
          label={t('scheduled.taskName')}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder={t('scheduled.taskNamePlaceholder')}
          autoFocus
        />
        <TextField
          multiline
          rows={7}
          label={t('scheduled.prompt')}
          hint={t('scheduled.promptHint')}
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder={t('scheduled.promptPlaceholder')}
        />
        <label className="scheduled-editor__schedule">
          <span>{t('scheduled.cadence')}</span>
          <Select
            value={interval}
            ariaLabel={t('scheduled.cadence')}
            menuPlacement="top"
            options={INTERVAL_OPTIONS.map((option) => ({
              value: option.value,
              label: t(option.labelKey),
            }))}
            onChange={setIntervalValue}
          />
        </label>
      </div>
      <footer className="scheduled-editor__actions">
        <Button onClick={onClose}>{t('scheduled.cancel')}</Button>
        <Button
          variant="primary"
          disabled={!title.trim() || !prompt.trim() || saving}
          onClick={() => void submit()}
        >
          {saving ? t('scheduled.saving') : t('scheduled.saveTask')}
        </Button>
      </footer>
    </Modal>
  );
};
