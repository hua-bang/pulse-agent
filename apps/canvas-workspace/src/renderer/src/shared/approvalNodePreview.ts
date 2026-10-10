import type { ComponentType } from 'react';
import type { CanvasNode } from '../types';

type ApprovalNodePreview = ComponentType<{ node: CanvasNode }>;
type ApprovalNodePreviewLoader = () => Promise<{ default: ApprovalNodePreview }>;

// Chat shows Canvas node previews in approval cards, but Canvas already
// depends on Chat. The app root injects the Canvas loader here so the two
// modules do not import each other.
let loader: ApprovalNodePreviewLoader | null = null;

export const setApprovalNodePreviewLoader = (next: ApprovalNodePreviewLoader): void => {
  loader = next;
};

export const loadApprovalNodePreview = (): Promise<{ default: ApprovalNodePreview }> => (
  loader ? loader() : Promise.reject(new Error('Approval node preview is unavailable.'))
);
