import { useEffect, useReducer, useRef } from 'react';
import type { ChatComposerRequest } from '../types';

interface Options {
  request?: ChatComposerRequest;
  focusInput: () => void;
  replaceInput: (text: string) => void;
  submitQuickAction: (prompt: string, quickAction?: string) => boolean | Promise<boolean>;
  onHandled?: (requestId: string) => void;
}

/** Runs a one-shot external composer request without changing ChatPanel chrome. */
export const useComposerRequest = ({ request, focusInput, replaceInput, submitQuickAction, onHandled }: Options) => {
  const handledRequestRef = useRef<string | null>(null);
  const inFlightRequestRef = useRef<string | null>(null);
  const submitVersionRef = useRef({ submit: submitQuickAction, version: 0 });
  const requestRef = useRef(request);
  const [, retryAfterRace] = useReducer((value: number) => value + 1, 0);
  requestRef.current = request;
  if (submitVersionRef.current.submit !== submitQuickAction) {
    submitVersionRef.current = {
      submit: submitQuickAction,
      version: submitVersionRef.current.version + 1,
    };
  }

  useEffect(() => {
    if (!request || handledRequestRef.current === request.id) return;
    if (request.submit && request.text) {
      if (inFlightRequestRef.current === request.id) return;
      inFlightRequestRef.current = request.id;
      const submitVersion = submitVersionRef.current.version;
      let accepted = false;
      void Promise.resolve(submitQuickAction(request.text, request.quickAction))
        .then((wasAccepted) => {
          accepted = wasAccepted;
          if (!wasAccepted) return;
          handledRequestRef.current = request.id;
          onHandled?.(request.id);
        })
        .catch(() => undefined)
        .finally(() => {
          if (inFlightRequestRef.current === request.id) inFlightRequestRef.current = null;
          if (
            !accepted
            && requestRef.current?.id === request.id
            && submitVersionRef.current.version !== submitVersion
          ) retryAfterRace();
        });
      return;
    }
    replaceInput(request.text ?? '');
    focusInput();
    handledRequestRef.current = request.id;
    onHandled?.(request.id);
  }, [focusInput, onHandled, replaceInput, request, retryAfterRace, submitQuickAction]);
};
