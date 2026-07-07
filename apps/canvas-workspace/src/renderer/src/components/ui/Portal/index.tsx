import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';

/**
 * The single portal exit for ui/ surfaces (and, over time, feature callers).
 * Direct createPortal call sites are counted by the ui-reuse governance
 * ratchet — new overlay code should render through <Portal> instead of
 * adding another call site.
 */
export const Portal = ({ children }: { children: ReactNode }) =>
  createPortal(children, document.body);
