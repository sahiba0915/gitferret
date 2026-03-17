import { readFile } from "node:fs/promises";
import { basename } from "node:path";

export type ReviewResult = {
  summary: string;
};

export async function reviewFile(filePath: string): Promise<ReviewResult> {
  const buf = await readFile(filePath);
  const bytes = buf.byteLength;
  const name = basename(filePath);
  return {
    summary: `Reviewed ${name}: ${bytes.toLocaleString()} bytes read.`
  };
}

