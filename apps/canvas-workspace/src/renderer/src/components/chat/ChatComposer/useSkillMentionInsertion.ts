import { useCallback, type RefObject } from 'react';
import type { CanvasNode } from '../../../types';
import { appendMentionChipToEditable } from '../utils/editableMentions';
import { createMentionChipElement, serializeEditable } from '../utils/mentions';

interface Options {
  editableRef: RefObject<HTMLDivElement>;
  nodes?: CanvasNode[];
  setInput: (value: string) => void;
}

/** Inserts a Skill reference without sending the message. */
export const useSkillMentionInsertion = ({ editableRef, nodes, setInput }: Options) =>
  useCallback((skillName: string) => {
    const element = editableRef.current;
    const normalized = skillName.trim();
    if (!element || !normalized) return;
    const chip = createMentionChipElement({ type: 'skill', label: normalized }, nodes);
    appendMentionChipToEditable(element, chip);
    setInput(serializeEditable(element));
    element.focus();
  }, [editableRef, nodes, setInput]);
