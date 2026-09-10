import { openSync, readSync, closeSync, constants } from 'node:fs';

// A2H reads files it did not create, in a directory tree it does not own. The
// only thing standing between a workspace and the rest of the machine is that
// A2H never follows a symlink out of it.
//
// Every read of workspace content goes through here. `O_NOFOLLOW` fails the
// open if the final path component is a symlink, so a link named `notes.md`
// pointing at `/etc/passwd` yields nothing rather than leaking a line of it
// into the UI. Intermediate directory components are still traversed, which is
// correct: the scanner rejects escapes before a path ever gets this far.
//
// `O_NOFOLLOW` is absent on Windows; there the flag degrades to 0 and the
// scanner's own symlink detection remains the control.

const O_NOFOLLOW: number =
  typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0;

/** Opens a file read-only, refusing to follow a final-component symlink. */
export function openNoFollow(path: string): number {
  return openSync(path, constants.O_RDONLY | O_NOFOLLOW);
}

/**
 * Reads up to `maxBytes` from the head of a file.
 * Returns undefined when the file cannot be read, or is a symlink.
 */
export function readHeadNoFollow(path: string, maxBytes: number): string | undefined {
  let fd: number | undefined;
  try {
    fd = openNoFollow(path);
    const buf = Buffer.alloc(maxBytes);
    const n = readSync(fd, buf, 0, maxBytes, 0);
    return buf.subarray(0, n).toString('utf8');
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** Reads up to `maxBytes` as raw bytes, with the same symlink guarantee. */
export function readBytesNoFollow(path: string, maxBytes: number): Buffer | undefined {
  let fd: number | undefined;
  try {
    fd = openNoFollow(path);
    const buf = Buffer.alloc(maxBytes);
    const n = readSync(fd, buf, 0, maxBytes, 0);
    return buf.subarray(0, n);
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
