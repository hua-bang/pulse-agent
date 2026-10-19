/**
 * The page's beforeunload handler vetoed a toolbar reload/back/forward. Ask in
 * the tab's notice strip, like the Google sign-in notice, instead of a native
 * dialog; Leave replays the vetoed action.
 */
import { useI18n } from '../../../../i18n';
import { Button } from '../../../../components/ui';
import { leavePageCopy, type UnloadPrompt } from '../../../../platform/browser/useUnloadPrompt';

export const LeavePagePrompt = ({ prompt }: { prompt: UnloadPrompt }) => {
  const { language } = useI18n();
  if (!prompt.blocked) return null;
  const copy = leavePageCopy(language);
  return (
    <div className="link-drawer__auth-notice" role="alertdialog" aria-label={copy.title}>
      <span className="link-drawer__auth-notice-text">
        {copy.title} {copy.message}
      </span>
      <Button variant="secondary" size="xs" onClick={prompt.stay}>
        {copy.stay}
      </Button>
      <Button variant="primary" size="xs" onClick={prompt.leave}>
        {copy.leave}
      </Button>
    </div>
  );
};
