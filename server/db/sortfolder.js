import fs from "fs";
import path from "path";
import { ParceStoreFile, parsePriceFile } from "./parser.js";
import { movetounparseable } from "./organizefiles.js";

export async function processAllFiles(folderPath) {
  const files = fs.readdirSync(folderPath);

  const storeFiles = files.filter(
    (f) => f.startsWith("Stores") && f.endsWith(".xml"),
  );

  // Each store file gets its own try/catch — one corrupted XML used to break
  // the for-of loop and silently skip every later file for the chain. Now a
  // single bad file logs and the batch continues.
  for (const file of storeFiles) {
    const fullPath = path.join(folderPath, file);
    console.log(file);
    try {
      await ParceStoreFile(fullPath);
    } catch (err) {
      console.error(`Error parsing store file ${file}:`, err.message);
    }
  }

  const priceFiles = files.filter(
    (f) =>
      (f.startsWith("Price") || f.startsWith("PriceFull")) &&
      f.endsWith(".xml"),
  );

  for (const file of priceFiles) {
    const fullPath = path.join(folderPath, file);

    let branchIdMatch = file.match(/-(\d{3})-\d{8}/);
    if (!branchIdMatch) {
      branchIdMatch = file.match(/-(\d+)-/);
    }
    const branchId = branchIdMatch ? branchIdMatch[1] : null;

    if (!branchId) {
      // Move to unparseable/ rather than process/. Previously unparseable
      // files went into process/ alongside successful imports — once moved
      // there nobody ever looked at them again, so a chain shipping a new
      // file-naming pattern was silent data loss.
      console.warn(`Skipped file with invalid name format: ${file}`);
      await movetounparseable(fullPath);
      continue;
    }

    console.log(`--- Processing prices for branch ${branchId}: ${file} ---`);
    try {
      await parsePriceFile(fullPath, branchId);
    } catch (err) {
      console.error(`Error parsing price file ${file}:`, err.message);
      // Leave the file in place — next run will retry. Don't auto-move to
      // unparseable since the issue may be transient (e.g. partial download).
    }
  }

  console.log("Finished scanning and processing all files!");
}
