import { useMemo } from 'react';
import { formatTimeOfDay, parseTimeOfDay } from '../../../../../shared/scheduled';
import { FieldRow, Select, type SelectOption } from '../../../components/ui';
import { useI18n } from '../../../i18n';

/**
 * Hour + minute pickers for a `HH:mm` schedule, built on `ui/Select` so the
 * open menu is app chrome. The native `<input type="time">` this replaces
 * rendered Chromium's own spinner popup, which ignores the app's palette and
 * sits next to the (blessed) Day dropdown looking like a different product.
 */

const MINUTE_STEP = 5;
const FALLBACK = { hour: 9, minute: 0 };

const pad = (value: number): string => String(value).padStart(2, '0');

interface Props {
  label: string;
  value: string;
  onChange: (next: string) => void;
}

export const TimeOfDaySelect = ({ label, value, onChange }: Props) => {
  const { t } = useI18n();
  const { hour, minute } = useMemo(() => {
    try {
      return parseTimeOfDay(value);
    } catch {
      return FALLBACK;
    }
  }, [value]);

  const hourOptions = useMemo<SelectOption[]>(
    () => Array.from({ length: 24 }, (_, index) => ({ value: pad(index), label: pad(index) })),
    [],
  );

  /**
   * The agent tools accept any `HH:mm`, so a stored 09:07 must stay
   * selectable — otherwise merely opening the editor would round it away.
   */
  const minuteOptions = useMemo<SelectOption[]>(() => {
    const values = new Set<number>();
    for (let candidate = 0; candidate < 60; candidate += MINUTE_STEP) values.add(candidate);
    values.add(minute);
    return [...values]
      .sort((a, b) => a - b)
      .map((candidate) => ({ value: pad(candidate), label: pad(candidate) }));
  }, [minute]);

  return (
    <FieldRow label={label}>
      <div className="scheduled-time">
        <Select
          value={pad(hour)}
          ariaLabel={t('scheduled.hour')}
          menuPlacement="top"
          options={hourOptions}
          onChange={(next) => onChange(formatTimeOfDay(Number(next), minute))}
        />
        <span className="scheduled-time__separator" aria-hidden="true">:</span>
        <Select
          value={pad(minute)}
          ariaLabel={t('scheduled.minute')}
          menuPlacement="top"
          options={minuteOptions}
          onChange={(next) => onChange(formatTimeOfDay(hour, Number(next)))}
        />
      </div>
    </FieldRow>
  );
};
