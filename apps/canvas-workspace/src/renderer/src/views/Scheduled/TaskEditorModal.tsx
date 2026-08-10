import { useEffect, useMemo, useState } from 'react';
import { Sparkle } from '@phosphor-icons/react';
import type {
  ScheduledSchedule,
  ScheduledTask,
  ScheduledTaskInput,
  ScheduledWeekday,
} from '../../../../shared/scheduled';
import { normalizeSchedule } from '../../../../shared/scheduled';
import { Button, FieldRow, Modal, Select, TextField, type SelectOption } from '../../components/ui';
import { useI18n } from '../../i18n';
import { useAppShell } from '../../components/shell/AppShellProvider';
import { intervalLabel, weekdayNames } from './formatters';
import { TimeOfDaySelect } from './TimeOfDaySelect';

/**
 * Cadence picker values. `interval:<minutes>` keeps the relative cadence
 * (next run = now + N); `daily` / `weekly` pin a local wall-clock time and
 * reveal the time (and weekday) controls.
 */
const CADENCE_OPTIONS = [
  { value: 'interval:30', labelKey: 'scheduled.interval.30m' },
  { value: 'interval:60', labelKey: 'scheduled.interval.1h' },
  { value: 'interval:360', labelKey: 'scheduled.interval.6h' },
  { value: 'interval:1440', labelKey: 'scheduled.interval.daily' },
  { value: 'interval:10080', labelKey: 'scheduled.interval.weekly' },
  { value: 'daily', labelKey: 'scheduled.cadence.dailyOption' },
  { value: 'weekly', labelKey: 'scheduled.cadence.weeklyOption' },
] as const;

const DEFAULT_TIME_OF_DAY = '09:00';
const DEFAULT_WEEKDAY: ScheduledWeekday = 1;

const cadenceValueOf = (schedule: ScheduledSchedule | undefined): string => {
  if (!schedule) return 'daily';
  return schedule.kind === 'interval' ? `interval:${schedule.intervalMinutes}` : schedule.kind;
};

const buildSchedule = (
  cadence: string,
  timeOfDay: string,
  weekday: ScheduledWeekday,
): ScheduledSchedule | null => {
  const candidate: ScheduledSchedule = cadence === 'daily'
    ? { kind: 'daily', timeOfDay }
    : cadence === 'weekly'
      ? { kind: 'weekly', weekday, timeOfDay }
      : { kind: 'interval', intervalMinutes: Number(cadence.slice('interval:'.length)) };
  try {
    return normalizeSchedule(candidate);
  } catch {
    return null;
  }
};

interface Props {
  open: boolean;
  task?: ScheduledTask;
  onClose: () => void;
  onSave: (input: ScheduledTaskInput) => Promise<boolean>;
}

export const TaskEditorModal = ({ open, task, onClose, onSave }: Props) => {
  const { t, language } = useI18n();
  const { notify } = useAppShell();
  const [title, setTitle] = useState('');
  const [prompt, setPrompt] = useState('');
  const [cadence, setCadence] = useState<string>('daily');
  const [timeOfDay, setTimeOfDay] = useState(DEFAULT_TIME_OF_DAY);
  const [weekday, setWeekday] = useState<ScheduledWeekday>(DEFAULT_WEEKDAY);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle(task?.title ?? '');
    setPrompt(task?.prompt ?? '');
    setCadence(cadenceValueOf(task?.schedule));
    setTimeOfDay(task?.schedule.kind === 'daily' || task?.schedule.kind === 'weekly'
      ? task.schedule.timeOfDay
      : DEFAULT_TIME_OF_DAY);
    setWeekday(task?.schedule.kind === 'weekly' ? task.schedule.weekday : DEFAULT_WEEKDAY);
    setGenerating(false);
  }, [open, task]);

  const schedule = useMemo(
    () => buildSchedule(cadence, timeOfDay, weekday),
    [cadence, timeOfDay, weekday],
  );
  const absolute = cadence === 'daily' || cadence === 'weekly';

  /**
   * A stored interval outside the presets (e.g. a hand-edited state file)
   * must stay representable, otherwise saving would silently rewrite it.
   */
  const cadenceOptions = useMemo(() => {
    const options: SelectOption[] = CADENCE_OPTIONS.map((option) => ({
      value: option.value,
      label: t(option.labelKey),
    }));
    if (!options.some((option) => option.value === cadence) && cadence.startsWith('interval:')) {
      options.unshift({
        value: cadence,
        label: intervalLabel(Number(cadence.slice('interval:'.length)), t),
      });
    }
    return options;
  }, [cadence, t]);

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
    if (!title.trim() || !prompt.trim() || !schedule || saving) return;
    setSaving(true);
    try {
      const saved = await onSave({
        title: title.trim(),
        prompt: prompt.trim(),
        schedule,
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
        <div className="scheduled-editor__cadence">
          <FieldRow label={t('scheduled.cadence')}>
            <Select
              value={cadence}
              ariaLabel={t('scheduled.cadence')}
              menuPlacement="top"
              options={cadenceOptions}
              onChange={setCadence}
            />
          </FieldRow>
          {cadence === 'weekly' && (
            <FieldRow label={t('scheduled.weekday')}>
              <Select
                value={String(weekday)}
                ariaLabel={t('scheduled.weekday')}
                menuPlacement="top"
                options={weekdayNames(language).map((label, index) => ({
                  value: String(index),
                  label,
                }))}
                onChange={(value) => setWeekday(Number(value) as ScheduledWeekday)}
              />
            </FieldRow>
          )}
          {absolute && (
            <TimeOfDaySelect
              label={t('scheduled.timeOfDay')}
              value={timeOfDay}
              onChange={setTimeOfDay}
            />
          )}
        </div>
        {absolute && (
          <p className="scheduled-editor__cadence-hint">{t('scheduled.timeOfDayHint')}</p>
        )}
      </div>
      <footer className="scheduled-editor__actions">
        <Button onClick={onClose}>{t('scheduled.cancel')}</Button>
        <Button
          variant="primary"
          disabled={!title.trim() || !prompt.trim() || !schedule || saving}
          onClick={() => void submit()}
        >
          {saving ? t('scheduled.saving') : t('scheduled.saveTask')}
        </Button>
      </footer>
    </Modal>
  );
};
