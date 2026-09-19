/**
 * Load the repo's .env.local into the scout UI's server process. Next only reads env files from
 * scout/ui; keys already set are left alone. Server-only: nothing here is NEXT_PUBLIC_.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT } from "../../lib/paths";

const file = join(REPO_ROOT, ".env.local");
if (!process.env.MONGODB_URI && existsSync(file)) process.loadEnvFile(file);
