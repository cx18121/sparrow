import { defineConfig, env } from "@prisma/config";
import { config } from "dotenv";
import { resolve } from "path";
import { fileURLToPath } from "url";

// Load .env.local first (precedence), then .env
const __dirname = resolve(fileURLToPath(import.meta.url), "..");
config({ path: resolve(__dirname, ".env.local") });
config({ path: resolve(__dirname, ".env") });

export default defineConfig({
  datasource: {
    url: env("DIRECT_URL"),
  },
});
