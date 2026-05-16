import { useEffect, useMemo, useState } from 'react';
import type { ChatCardSpec, ChatMessageRef } from '../types';
import { getRegisteredChatCards } from './registry';

interface Match {
  spec: ChatCardSpec<unknown, unknown>;
  ref: unknown;
}

// Convenience component: finds the first plugin chat card that matches
// the given message, then renders it — handling the sync path (no
// resolve) and the async path (with resolve, Loading, Error) uniformly.
//
// Hosts render <PluginChatCardForMessage message={msg} /> once per
// message; the component returns null when nothing matches.
export function PluginChatCardForMessage<T extends ChatMessageRef>({
  message,
}: {
  message: T;
}) {
  const match = useMemo<Match | null>(() => {
    for (const entry of getRegisteredChatCards()) {
      const ref = entry.spec.match(message);
      if (ref != null) return { spec: entry.spec, ref };
    }
    return null;
  }, [message]);

  if (!match) return null;
  if (!match.spec.resolve) {
    const Component = match.spec.Component;
    return <Component payload={match.ref} />;
  }
  return <AsyncChatCard spec={match.spec} refValue={match.ref} />;
}

function AsyncChatCard({
  spec,
  refValue,
}: {
  spec: ChatCardSpec<unknown, unknown>;
  refValue: unknown;
}) {
  type State =
    | { status: 'loading' }
    | { status: 'done'; payload: unknown }
    | { status: 'error'; error: unknown };
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    let canceled = false;
    setState({ status: 'loading' });
    Promise.resolve()
      .then(() => spec.resolve!(refValue))
      .then(
        (payload) => {
          if (!canceled) setState({ status: 'done', payload });
        },
        (error) => {
          if (!canceled) setState({ status: 'error', error });
        },
      );
    return () => {
      canceled = true;
    };
  }, [spec, refValue]);

  if (state.status === 'loading') {
    return spec.Loading ? <spec.Loading ref={refValue} /> : null;
  }
  if (state.status === 'error') {
    return spec.Error ? <spec.Error ref={refValue} error={state.error} /> : null;
  }
  return <spec.Component payload={state.payload} />;
}
