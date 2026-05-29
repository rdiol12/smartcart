// after
import { config } from "dotenv";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

config({ path: path.resolve(__dirname, "../.env") });

const REQUIRED = [
  "DATABASE_URL",
  "JWT_SECRET",
  "JWT_REFRESH_SECRET",
  "JWT_EMAIL_SECRET",
  "JWT_RESET_SECRET",
];

export function validateEnv() {
  const missing = REQUIRED.filter((k) => !process.env[k]);
  if (missing.length === 0) return;
  console.error(
    `Missing required env vars: ${missing.join(", ")}. ` +
      `See README for the full list.`,
  );
  process.exit(1);
}
