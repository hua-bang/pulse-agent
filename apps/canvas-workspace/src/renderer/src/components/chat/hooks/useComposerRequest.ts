import { useEffect, useRef } from 'react';
import type { ChatComposerRequest } from '../types';

interface Options {
  request?: ChatComposerRequest;
  focusInput: () => void;
  replaceInput: (text: string) => void;
  submitQuickAction: (prompt: string, quickAction?: string) => void;
}

/** Runs a one-shot external composer request without changing ChatPanel chrome. */
export const useComposerRequest = ({ request, focusInput, replaceInput, submitQuickAction }: Options) => {
  const handledRequestRef = useRef<string | null>(null);

  useEffect(() => {
    if (!request || handledRequestRef.current === request.id) return;
    handledRequestRef.current = request.id;
    if (request.submit && request.text) {
      submitQuickAction(request.text, request.quickAction);
      return;
    }
    replaceInput(request.text ?? '');
    focusInput();
  }, [focusInput, replaceInput, request, submitQuickAction]);
};
