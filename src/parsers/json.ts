import type { JsonContent } from '../types';
import { readFileText } from './text';

const MAX_JSON_BYTES = 2 * 1024 * 1024;

export function parseJson(path: string): JsonContent {
  const { text, truncated } = readFileText(path, MAX_JSON_BYTES);
  try {
    const data = JSON.parse(text);
    return { type: 'json', data, valid: true, raw: text, truncated };
  } catch {
    return { type: 'json', data: undefined, valid: false, raw: text, truncated };
  }
}
