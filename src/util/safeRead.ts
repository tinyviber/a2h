import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from 'node:fs';

// A2H reads files it did not create, in a directory tree it does not own. The
// only thing standing between a workspace and the rest of the machine is that
// A2H never follows a symlink out of it.
//
// Every read of workspace content goes through here. `O_NOFOLLOW` fails the
// open if the final path component is a symlink, so a link named `notes.md`
// pointing at `/etc/passwd` yields nothing rather than leaking a line of it
// into the UI. Intermediate directory components are still traversed; callers
// pair this with `resolveRealPath` so an intermediate link out of the tree is
// caught before the read, not after.
//
// Nothing in this file trusts its caller to have checked anything.
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

export interface BoundedRead {
  text: string;
  /** True when the file was longer than the cap and got cut. */
  truncated: boolean;
  totalBytes: number;
}

/**
 * Reads a whole file, capped at `maxBytes`.
 *
 * Unlike `readFileText`, an unreadable file is reported as `undefined` rather
 * than an empty string — the difference between "no content" and "refused to
 * read" matters at a security boundary.
 */
export function readFileNoFollow(path: string, maxBytes: number): BoundedRead | undefined {
  let fd: number | undefined;
  try {
    fd = openNoFollow(path);
    const stat = fstatSync(fd);
    const totalBytes = stat.size;
    const toRead = Math.min(totalBytes, maxBytes);
    const buf = Buffer.alloc(toRead);
    const n = readSync(fd, buf, 0, toRead, 0);
    return {
      text: buf.subarray(0, n).toString('utf8'),
      truncated: totalBytes > maxBytes,
      totalBytes,
    };
  } catch {
    return undefined;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

export interface NoFollowStat {
  isFile: boolean;
  isDirectory: boolean;
  isSymbolicLink: boolean;
  size: number;
}

/**
 * Metadata for a path, without following a final-component symlink.
 *
 * `statSync` would follow the link, so a link named `manifest.json` would look
 * like a perfectly ordinary file of the target's size. `lstatSync` describes
 * the link itself, which is what a caller deciding whether to read must know.
 */
export function statNoFollow(path: string): NoFollowStat | undefined {
  try {
    const st = lstatSync(path);
    return {
      isFile: st.isFile(),
      isDirectory: st.isDirectory(),
      isSymbolicLink: st.isSymbolicLink(),
      size: st.size,
    };
  } catch {
    return undefined;
  }
}
