import { describe, expect, it } from 'vitest';
import { extractGeneratedImageResult, extractGeneratedImageResults } from './image-result.js';

describe('extractGeneratedImageResult', () => {
  it('extracts normal generate_image tool payloads', () => {
    expect(extractGeneratedImageResult({
      toolName: 'generate_image',
      output: {
        model: 'image-model',
        outputPath: '/tmp/out.png',
        mimeType: 'image/png',
      },
    })).toEqual({
      outputPath: '/tmp/out.png',
      mimeType: 'image/png',
    });
  });

  it('extracts explicitly marked image payloads from bash output', () => {
    const toolResult = {
      type: 'tool-result',
      toolName: 'bash',
      output: {
        output: [
          'published dashboard',
          '__PULSE_IMAGE_RESULT__{"model":"perf-dashboard-screenshot","outputPath":"/tmp/dashboard.png","mimeType":"image/png"}',
          '__PULSE_IMAGE_RESULT__{"model":"perf-electron-startup-screenshot","outputPath":"/tmp/electron-startup.png","mimeType":"image/png"}',
        ].join('\n'),
        exitCode: 0,
      },
    };

    expect(extractGeneratedImageResult(toolResult)).toEqual({
      outputPath: '/tmp/dashboard.png',
      mimeType: 'image/png',
    });
    expect(extractGeneratedImageResults(toolResult)).toEqual([
      {
        outputPath: '/tmp/dashboard.png',
        mimeType: 'image/png',
      },
      {
        outputPath: '/tmp/electron-startup.png',
        mimeType: 'image/png',
      },
    ]);
  });

  it('ignores unmarked bash output paths', () => {
    expect(extractGeneratedImageResult({
      type: 'tool-result',
      toolName: 'bash',
      output: {
        output: '{"model":"perf-dashboard-screenshot","outputPath":"/tmp/dashboard.png","mimeType":"image/png"}',
        exitCode: 0,
      },
    })).toBeNull();
  });
});
