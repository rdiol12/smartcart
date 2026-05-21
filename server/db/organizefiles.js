import path from "path";
import { rename, mkdir } from "fs/promises";

export async function movetoprocess(filepath) {
  try {
    const filename = path.basename(filepath);
    const dirname = path.dirname(filepath);
    const dest = path.join(dirname, "process");
    const targetPath = path.join(dest, filename);
    await mkdir(dest, { recursive: true });
    await rename(filepath, targetPath);
    console.log(`good ${filename}`);
  } catch (e) {
    console.error(e);
  }
}

/**
 * Move a file out of the way without claiming it was processed. Used for
 * inputs we couldn't parse (e.g. file name doesn't match the expected
 * pattern). Previously these went into process/ alongside successful
 * imports — silent data loss, since "process/" was effectively "done".
 * Use a separate unparseable/ bucket so a human can notice and either
 * fix the regex or hand-clean the file.
 */
export async function movetounparseable(filepath) {
  try {
    const filename = path.basename(filepath);
    const dirname = path.dirname(filepath);
    const dest = path.join(dirname, "unparseable");
    const targetPath = path.join(dest, filename);
    await mkdir(dest, { recursive: true });
    await rename(filepath, targetPath);
    console.warn(`Moved to unparseable: ${filename}`);
  } catch (e) {
    console.error(e);
  }
}
