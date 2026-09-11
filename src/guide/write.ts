import { writeWorkspaceFile, type WorkspaceWriteCode } from '../security/writeWorkspaceFile';
import { AGENT_GUIDE_MARKER, AGENT_GUIDE_PATH } from './generate';

// ---------------------------------------------------------------------------
// The guide's write policy, in one place.
//
// `writeGuide` adds exactly one thing to the shared writer: which marker makes
// an existing file replaceable. Keeping the marker next to the generator that
// emits it means the two cannot drift — a file is overwritten only if it says,
// in the bytes the generator wrote, that it is generated.
// ---------------------------------------------------------------------------

export interface GuideWriteResult {
  written: boolean;
  /** Workspace-relative path of the guide, whatever the outcome. */
  path: string;
  /** Why nothing was written. Diagnostics only. */
  reason?: string;
  code?: WorkspaceWriteCode;
}

export function writeGuide(
  rootDir: string,
  content: string,
  options: { force?: boolean } = {},
): GuideWriteResult {
  const result = writeWorkspaceFile(rootDir, AGENT_GUIDE_PATH, content, {
    force: options.force,
    marker: AGENT_GUIDE_MARKER,
  });

  return {
    written: result.written,
    path: AGENT_GUIDE_PATH,
    reason: result.reason,
    code: result.code,
  };
}
