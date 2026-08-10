import React from 'react';
import { TranscriptEvent } from './transcript-event.js';
import { stringWidth } from '../terminal/text-width.js';
import { truncateLabel, windowLiveTextLines } from './app-format.js';
import { PICKER_HINT } from './ink-types.js';
import type { InkCliEvent, InkCliSnapshot, InkPickerState } from './ink-types.js';
import type { ComposerLayout } from './use-composer-layout.js';

export interface AppViewProps {
  layout: ComposerLayout;
  snapshot: InkCliSnapshot;
  input: string;
  ctrlCArmed: boolean;
  picker: InkPickerState | null;
  pickerQuery: string;
  Box: React.ComponentType<any>;
  Text: React.ComponentType<any>;
  Static: React.ComponentType<any>;
}

/** The full Ink frame: static transcript, live region, picker or composer. */
export function AppView({ layout, snapshot, input, ctrlCArmed, picker, pickerQuery, Box, Text, Static }: AppViewProps) {
  const {
    terminalColumns,
    spinner,
    pickerItems,
    clampedPickerIndex,
    showPickerHint,
    pickerWindowStart,
    visiblePickerItems,
    pickerContentWidth,
    clampToPickerWidth,
    slashSuggestions,
    fileSuggestions,
    normalizedFileIndex,
    normalizedSuggestionIndex,
    visiblePromptRows,
    hiddenPromptRowCount,
    keyHint,
    composerColor,
    statusColor,
    statusPrefix,
    statusline,
    visibleLiveTools,
    hiddenLiveToolCount,
    liveTextWindow,
    hiddenLiveTextCount,
  } = layout;

return (
  <Box flexDirection="column">
    <Static items={snapshot.events}>
      {(event: InkCliEvent) => <TranscriptEvent key={event.id} event={event} Box={Box} Text={Text} terminalColumns={terminalColumns} />}
    </Static>

    {/* No visible tail means no room at all — the head alone would just cost
        a row without showing any of the answer.

        Plain text, gray — matching the color a segment gets once a tool
        call finalizes it as narration. Rendering markdown here too used to
        mean every streamed answer flashed bright, then jumped to gray the
        moment a tool call finalized it (or stayed bright if none did,
        which was its own inconsistency). Now the jump happens at most once
        per run, when the final answer lands in `<Static>` with markdown —
        gray while it is provisional, bright once it is the real answer. */}
    {liveTextWindow.lines.length > 0 ? (
      <Box flexDirection="column" marginTop={1}>
        {hiddenLiveTextCount > 0 ? (
          <Text color="gray" dimColor>… {hiddenLiveTextCount} earlier line{hiddenLiveTextCount === 1 ? '' : 's'}</Text>
        ) : null}
        <Text color="gray">{liveTextWindow.lines.join('\n')}</Text>
      </Box>
    ) : null}

    {hiddenLiveToolCount > 0 ? (
      <Text color="gray" dimColor>… {hiddenLiveToolCount} more tool{hiddenLiveToolCount === 1 ? '' : 's'} running</Text>
    ) : null}
    {visibleLiveTools.map(tool => (
      <Text key={tool.id}>
        <Text color="yellow" dimColor>{spinner} </Text>
        <Text color="gray">{truncateLabel(tool.label, terminalColumns - 4)}</Text>
      </Text>
    ))}

    <Box marginTop={1}>
      <Text color={statusColor}>{statusPrefix}</Text>
      <Text color="gray"> · {statusline}</Text>
    </Box>

    {picker ? (
      <Box flexDirection="column">
        <Box borderStyle="round" borderColor="cyan" paddingX={1} flexDirection="column">
          <Text bold color="cyan">{picker.title}{pickerQuery ? <Text color="gray"> · filter: {pickerQuery}</Text> : null}</Text>
          {pickerItems.length === 0 ? (
            <Text color="gray">No matches. Backspace to clear the filter, Esc to cancel.</Text>
          ) : visiblePickerItems.map((item, index) => {
            const actualIndex = pickerWindowStart + index;
            const selected = actualIndex === clampedPickerIndex;
            // Hint gets at most a third of the row; the label takes the rest.
            const hint = truncateLabel(
              `${item.isCurrent ? 'current' : ''}${item.isCurrent && item.hint ? ' · ' : ''}${item.hint ?? ''}`,
              Math.floor(pickerContentWidth / 3),
            );
            const label = truncateLabel(item.label, clampToPickerWidth(pickerContentWidth - 2 - (hint ? stringWidth(hint) + 2 : 0)));
            return (
              <Box key={item.id} flexDirection="column">
                <Text color={selected ? 'yellow' : undefined}>
                  {selected ? '→ ' : '  '}{label}{hint ? <Text color="gray">  {hint}</Text> : null}
                </Text>
                {item.preview ? <Text color="gray" dimColor>    {truncateLabel(item.preview, clampToPickerWidth(pickerContentWidth - 4))}</Text> : null}
              </Box>
            );
          })}
          {pickerItems.length > visiblePickerItems.length ? (
            <Text color="gray">… {pickerItems.length - visiblePickerItems.length} more (↑↓ to scroll)</Text>
          ) : null}
        </Box>
        {showPickerHint ? <Text color="gray">{PICKER_HINT}</Text> : null}
      </Box>
    ) : (
      <Box flexDirection="column">
        <Box borderStyle="round" borderColor={composerColor} paddingX={1} flexDirection="column">
          {hiddenPromptRowCount > 0 ? <Text color="gray">… {hiddenPromptRowCount} earlier draft line{hiddenPromptRowCount === 1 ? '' : 's'}</Text> : null}
          {visiblePromptRows.map((line, index) => (
            <Text key={`${index}-${line}`} color="cyan">
              {index === 0 ? '› ' : '  '}<Text color="white">{line || ' '}</Text>
            </Text>
          ))}
        </Box>

        {fileSuggestions.length > 0 ? (
          <Box flexDirection="column">
            {fileSuggestions.map((entry, index) => (
              <Text key={entry.relPath} color={index === normalizedFileIndex ? 'yellow' : 'gray'}>
                {index === normalizedFileIndex ? '→ ' : '  '}@{truncateLabel(entry.relPath, terminalColumns - 8)}{entry.isDirectory ? '/' : ''}
              </Text>
            ))}
          </Box>
        ) : null}

        {slashSuggestions.length > 0 ? (
          <Box flexDirection="column">
            {slashSuggestions.map((suggestion, index) => {
              const selected = index === normalizedSuggestionIndex;
              const detail = `${suggestion.group === 'Skill' ? '[skill] ' : ''}${suggestion.description}${selected && suggestion.usage ? ` · ${suggestion.usage}` : ''}`;
              return (
                <Text key={suggestion.command} color={selected ? 'yellow' : 'gray'}>
                  {selected ? '→ ' : '  '}{suggestion.command}  <Text color="gray">{truncateLabel(detail, Math.max(8, terminalColumns - 4 - stringWidth(suggestion.command)))}</Text>
                </Text>
              );
            })}
          </Box>
        ) : null}

        <Text color="gray">{keyHint}</Text>
      </Box>
    )}
  </Box>
);
}
