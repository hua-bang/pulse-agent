import { useEffect, useState } from 'react';
import { Sparkle } from '@phosphor-icons/react';
import type { ScheduledTask, ScheduledTaskInput } from '../../../../shared/scheduled';
import { Button, FieldRow, Modal, Select, TextField } from '../ui';
import { useI18n } from '../../i18n';
import { useAppShell } from '../AppShellProvider';

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
  const { notify } = useAppShell();
  const [title, setTitle] = useState('');
  const [prompt, setPrompt] = useState('');
  const [interval, setIntervalValue] = useState('1440');
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle(task?.title ?? '');
    setPrompt(task?.prompt ?? '');
    setIntervalValue(String(task?.intervalMinutes ?? 1440));
    setGenerating(false);
  }, [open, task]);

  const generatePrompt = async () => {
    if ((!title.trim() && !prompt.trim()) || generating) return;
    setGenerating(true);
    try {
      const response = await window.canvasWorkspace.agent.polishScheduledPrompt({
        title: title.trim(),
        currentPrompt: prompt.trim() || undefined,
      });
      if (response.ok && response.content) {
        setPrompt(response.content);
      } else {
        notify({
          tone: 'error',
          title: t('scheduled.aiFailed'),
          description: response.error,
        });
      }
    } catch (error) {
      notify({
        tone: 'error',
        title: t('scheduled.aiFailed'),
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setGenerating(false);
    }
  };

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
        <div className="scheduled-editor__prompt-field">
          <div className="scheduled-editor__prompt-heading">
            <span id="scheduled-editor-prompt-label">{t('scheduled.prompt')}</span>
            <Button
              size="xs"
              disabled={(!title.trim() && !prompt.trim()) || generating}
              onClick={() => void generatePrompt()}
            >
              <Sparkle size={13} weight="fill" />
              {generating ? t('scheduled.aiGenerating') : t('scheduled.aiPolish')}
            </Button>
          </div>
          <TextField
            multiline
            rows={7}
            aria-labelledby="scheduled-editor-prompt-label"
            hint={t('scheduled.promptHint')}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder={t('scheduled.promptPlaceholder')}
            readOnly={generating}
          />
        </div>
        <FieldRow label={t('scheduled.cadence')}>
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
        </FieldRow>
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
