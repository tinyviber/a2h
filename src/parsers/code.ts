import type { CodeContent } from '../types';
import { readFileText, splitLines } from './text';

const MAX_CODE_BYTES = 512 * 1024;

export function parseCode(path: string, language: string): CodeContent {
  const { text, truncated } = readFileText(path, MAX_CODE_BYTES);
  const lines = splitLines(text);
  return {
    type: 'code',
    language: language || 'text',
    raw: text,
    totalLines: lines.length,
    truncated,
  };
}
