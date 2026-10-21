import { useEffect } from 'react';
import { useI18n } from '../../../i18n';
import { useAppShell } from '../AppShellProvider';

/**
 * First-launch notice for anonymous usage telemetry. Main holds every event
 * until the user chooses here (or in Settings), so the notice comes before
 * any send, including `app_started`. Accept keeps telemetry on; decline or
 * Esc turns it off. A choice that fails to save shows the notice again on
 * the next launch.
 */
export const TelemetryNoticeBridge = () => {
  const { confirm } = useAppShell();
  const { t } = useI18n();

  useEffect(() => {
    let active = true;
    const telemetry = window.canvasWorkspace?.telemetry;
    void telemetry?.status()
      .then(async (status) => {
        if (!active || !status.configured || status.noticeSeen) return;
        const accepted = await confirm({
          title: t('telemetry.notice.title'),
          description: t('telemetry.notice.description'),
          confirmLabel: t('telemetry.notice.accept'),
          cancelLabel: t('telemetry.notice.decline'),
        });
        await telemetry.setEnabled(accepted);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
    // Once per app run; a language change must not reopen the notice.
  }, []);

  return null;
};
