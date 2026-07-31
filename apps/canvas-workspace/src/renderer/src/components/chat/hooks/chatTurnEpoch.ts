import type { MutableRefObject } from 'react';

export function createChatTurnEpochGuard(
  epochRef: MutableRefObject<number>,
  epoch: number,
) {
  const isCurrent = () => epochRef.current === epoch;
  const guard = <Args extends unknown[]>(handler: (...args: Args) => void) => (
    ...args: Args
  ) => {
    if (isCurrent()) handler(...args);
  };
  return { isCurrent, guard };
}
