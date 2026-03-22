import { defineConfig, env } from "@prisma/config";
import { config } from "dotenv";

config();

export default defineConfig({
  datasource: {
    url: env("DATABASE_URL"),
  },
});
