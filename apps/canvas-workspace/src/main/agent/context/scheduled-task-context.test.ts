import { describe, expect, it } from 'vitest';
import { formatScheduledTaskContextBlock } from './scheduled-task-context';

describe('formatScheduledTaskContextBlock', () => {
  it('adds nothing without selected tasks', () => {
    expect(formatScheduledTaskContextBlock()).toBe('');
    expect(formatScheduledTaskContextBlock([])).toBe('');
  });

  it('names each selected task with its id on one line', () => {
    const block = formatScheduledTaskContextBlock([{ id: 'daily-brief', title: 'Daily\nbrief `v2`' }]);

    expect(block).toContain('## Scheduled Tasks In Context');
    expect(block).toContain("- **Daily brief 'v2'** (task id: `daily-brief`)");
    expect(block).toContain('scheduled_task_update');
  });
});
