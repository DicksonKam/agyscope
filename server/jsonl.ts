import { openSync, readSync, closeSync, statSync } from "node:fs";
import type { FileCursor } from "../shared/types.ts";

export const maxLineBytes = 2 * 1024 * 1024; // 2 MB cap per JSONL line

export interface JsonlReadResult {
  cursor: FileCursor;
  bytes: number;
  lines: number;
  skippedOversize: number;
}

/**
 * Incremental streaming JSONL reader with inode + offset tracking.
 * Safe against truncated/partial trailing lines and oversized blobs.
 */
export function readJsonlIncremental(
  filePath: string,
  previous: FileCursor | undefined,
  parserVersion: number,
  onLine: (line: string, lineIndex: number) => void,
): JsonlReadResult | null {
  let st;
  try {
    st = statSync(filePath);
  } catch {
    return null;
  }
  if (!st.isFile()) return null;
  const inode = `${st.dev}:${st.ino}`;
  const modified = Math.trunc(st.mtimeMs);
  const reset =
    !previous ||
    previous.inode !== inode ||
    previous.parser !== parserVersion ||
    previous.offset > st.size;

  const startOffset = reset ? 0 : previous.offset;
  if (!reset && startOffset === st.size && previous.modified === modified)
    return null;

  const totalToRead = st.size - startOffset;
  if (totalToRead <= 0) {
    return {
      cursor: { offset: st.size, inode, modified, parser: parserVersion },
      bytes: 0,
      lines: 0,
      skippedOversize: 0,
    };
  }

  const fd = openSync(filePath, "r");
  const chunkSize = 64 * 1024;
  const buf = Buffer.allocUnsafe(chunkSize);
  let pos = startOffset;
  let leftover = Buffer.alloc(0);
  let consumedBytes = 0;
  let lines = 0;
  let skippedOversize = 0;
  let oversize = false;

  try {
    while (pos < st.size) {
      const read = readSync(
        fd,
        buf,
        0,
        Math.min(chunkSize, st.size - pos),
        pos,
      );
      if (read <= 0) break;
      pos += read;
      const slice = buf.subarray(0, read);
      let cursorIdx = 0;
      while (cursorIdx < slice.length) {
        const nl = slice.indexOf(0x0a, cursorIdx);
        if (nl === -1) {
          const piece = slice.subarray(cursorIdx);
          if (!oversize) {
            if (leftover.length + piece.length > maxLineBytes) {
              oversize = true;
              leftover = Buffer.alloc(0);
            } else {
              leftover = Buffer.concat([leftover, piece]);
            }
          }
          break;
        }
        const piece = slice.subarray(cursorIdx, nl);
        const lineByteLen = leftover.length + piece.length + 1;
        if (oversize || leftover.length + piece.length > maxLineBytes) {
          skippedOversize++;
          oversize = false;
          leftover = Buffer.alloc(0);
        } else {
          const full =
            leftover.length > 0 ? Buffer.concat([leftover, piece]) : piece;
          leftover = Buffer.alloc(0);
          const text = full.toString("utf8").trim();
          if (text.length > 0) {
            onLine(text, lines);
            lines++;
          }
        }
        consumedBytes += lineByteLen;
        cursorIdx = nl + 1;
      }
    }
  } finally {
    closeSync(fd);
  }

  // Only advance offset past complete newline-terminated lines so an in-flight append is picked up next pass.
  const newOffset = startOffset + consumedBytes;
  return {
    cursor: { offset: newOffset, inode, modified, parser: parserVersion },
    bytes: consumedBytes,
    lines,
    skippedOversize,
  };
}
