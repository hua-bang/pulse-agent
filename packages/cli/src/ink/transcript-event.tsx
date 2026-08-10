import React from 'react';
import { renderMarkdownAnsi } from '../terminal/markdown.js';
import { stringWidth } from '../terminal/text-width.js';
import { truncateLabel } from './app-format.js';
import type { InkCliEvent } from './ink-types.js';

/** One finalized transcript block rendered inside Ink's <Static>. */
export function TranscriptEvent({ event, Box, Text, terminalColumns }: { event: InkCliEvent; Box: React.ComponentType<any>; Text: React.ComponentType<any>; terminalColumns: number }) {
  if (event.kind === 'log') {
    return <Text color="gray" dimColor>{event.text}</Text>;
  }

  if (event.kind === 'tool') {
    // Tool traces are secondary: everything gray, a hint of color on the icon
    // only. Failures are the exception — they stay bright red.
    const isError = event.status === 'error';
    const icon = isError ? '✕' : event.status === 'info' ? '·' : '✓';
    const previewLines = event.text ? event.text.split('\n') : [];
    // title and summary are kept as SEPARATE fields (not one concatenated
    // string) so the summary never orphan-wraps onto its own row: the LABEL
    // is what gets truncated against the terminal width, the summary always
    // stays whole on the same line. Budget: icon + space (2 cols) + the
    // summary's own " · <summary>" + a little slack (3 cols).
    const summary = event.summary;
    const summaryWidth = summary ? stringWidth(` · ${summary}`) : 0;
    const labelBudget = Math.max(1, terminalColumns - 2 - summaryWidth - 3);
    const label = truncateLabel(event.title ?? 'tool', labelBudget);
    return (
      <Box flexDirection="column">
        <Text>
          {isError
            ? <Text color="red">{icon} </Text>
            : <Text color={event.status === 'info' ? 'gray' : 'green'} dimColor>{icon} </Text>}
          <Text color={isError ? 'red' : 'gray'}>{label}</Text>
          {summary ? <Text color="gray"> · {summary}</Text> : null}
        </Text>
        {previewLines.map((line, index) => (
          <Text key={index} color="gray" dimColor>  {index === 0 ? '⎿ ' : '  '}{line}</Text>
        ))}
      </Box>
    );
  }

  if (event.kind === 'user') {
    // The user's own turns must stay findable when scrolling back through a
    // long run: bold DEFAULT-foreground text (hardcoded white disappears on
    // light terminal themes) and the `›` gutter on every line, so a pasted
    // multi-line prompt reads as one attributed block.
    const lines = event.text.split('\n');
    return (
      <Box flexDirection="column" marginTop={1}>
        {lines.map((line, index) => (
          <Text key={index}>
            <Text color="cyan">{index === 0 ? '› ' : '  '}</Text>
            <Text bold>{line || ' '}</Text>
          </Text>
        ))}
      </Box>
    );
  }

  if (event.kind === 'assistant') {
    // Narration between tool calls (status: 'info') sits at the tool-trace
    // layer; only the answer segment that ends a run renders bright.
    if (event.status === 'info') {
      return (
        <Box flexDirection="column" marginTop={1}>
          <Text color="gray">{event.text}</Text>
        </Box>
      );
    }
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text>{renderMarkdownAnsi(event.text)}</Text>
      </Box>
    );
  }

  if (event.kind === 'error') {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text color="red">{event.title ? `${event.title} · ` : ''}{event.text}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      {event.title ? <Text bold color="blue">{event.title}</Text> : null}
      <Text color="gray">{event.text}</Text>
    </Box>
  );
}
