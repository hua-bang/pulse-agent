import { useCallback, useEffect, useRef } from 'react';
import { useI18n } from '../../../i18n';
import { useAppShell } from '../../AppShellProvider';
import type { SessionBackEntry } from '../SessionBackBar';

interface NewSessionResult {
  ok: boolean;
  error?: string;
}

interface Options {
  loading: boolean;
  clearInput: () => void;
  handleNewSession: () => Promise<NewSessionResult>;
  insertSkillMention: (skillName: string) => void;
  setSessionBackStack: (entries: SessionBackEntry[]) => void;
  onRegister?: (fn: (skillName: string) => Promise<void>) => () => void;
}

export const useStartSkillChat = ({
  loading,
  clearInput,
  handleNewSession,
  insertSkillMention,
  setSessionBackStack,
  onRegister,
}: Options) => {
  const { t } = useI18n();
  const { notify } = useAppShell();
  const inFlightRef = useRef(false);
  const reportError = useCallback((description?: string) => {
    notify({ tone: 'error', title: t('skillsLibrary.chatStartFailed'), description });
  }, [notify, t]);
  const startSkillChat = useCallback(async (skillName: string) => {
    if (loading || inFlightRef.current) {
      reportError(t('skillsLibrary.chatBusy'));
      return;
    }
    inFlightRef.current = true;
    try {
      const result = await handleNewSession();
      if (!result.ok) {
        reportError(result.error);
        return;
      }
      setSessionBackStack([]);
      clearInput();
      insertSkillMention(skillName);
      notify({ tone: 'success', title: t('skillsLibrary.chatStarted', { name: skillName }) });
    } catch (error) {
      reportError(error instanceof Error ? error.message : undefined);
    } finally {
      inFlightRef.current = false;
    }
  }, [clearInput, handleNewSession, insertSkillMention, loading, notify, reportError, setSessionBackStack, t]);

  useEffect(() => onRegister?.(startSkillChat), [onRegister, startSkillChat]);
};
