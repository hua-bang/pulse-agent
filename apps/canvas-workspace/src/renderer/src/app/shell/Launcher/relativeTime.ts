const STEPS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['minute', 60],
  ['hour', 60],
  ['day', 24],
  ['week', 7],
  ['month', 4.35],
  ['year', 12],
];

/** "3 hours ago" / "3小时前" in the app language. */
export const formatRelativeTime = (timestamp: number, language: string, now = Date.now()): string => {
  const locale = language === 'zh' ? 'zh-CN' : 'en';
  const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  let value = (timestamp - now) / 1000;
  let unit: Intl.RelativeTimeFormatUnit = 'second';
  for (const [nextUnit, size] of STEPS) {
    if (Math.abs(value) < size) break;
    value /= size;
    unit = nextUnit;
  }
  return format.format(Math.round(value), unit);
};
