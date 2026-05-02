import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { config as dotenvConfig } from "dotenv";

// Load .env.local first, then .env (so .env.local takes precedence)
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenvConfig({ path: resolve(__dirname, ".env.local") });
dotenvConfig({ path: resolve(__dirname, ".env") });

import express from "express";
import { createServer } from "http";
import type { ApiHandler } from "./server/router.js";

function wrapHandler(handler: ApiHandler) {
  return async (req: express.Request, res: express.Response) => {
    const vercelReq = {
      method: req.method,
      url: req.originalUrl,
      query: req.query,
      headers: req.headers,
      body: req.body,
      cookies: req.cookies,
      rawBody: req.body,
    };
    const vercelRes = {
      status: (code: number) => {
        res.status(code);
        return vercelRes;
      },
      json: (data: any) => res.json(data),
      setHeader: (name: string, value: string) => res.setHeader(name, value),
      send: (data: any) => res.send(data),
      end: (data?: any) => res.end(data),
    };
    try {
      await handler(vercelReq, vercelRes);
    } catch (err: any) {
      console.error(`Handler error for ${req.method} ${req.url}:`, err.message);
      res.status(500).json({ error: err.message });
    }
  };
}

async function start() {
  const { routeHandlers } = await import("./server/router.js");

  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  for (const route of Object.keys(routeHandlers)) {
    console.log(`✓ Loaded ${route}`);
  }

  for (const [route, handler] of Object.entries(routeHandlers)) {
    app.all(route, wrapHandler(handler));
  }

  app.use((_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  const PORT = process.env.PORT || 3000;

  createServer(app).listen(PORT, () => {
    console.log(`\n🚀 Local API server running at http://localhost:${PORT}`);
    console.log(`   Health check: http://localhost:${PORT}/api/health`);
    console.log(`   ${Object.keys(routeHandlers).length} route(s) loaded\n`);
  });
}

start().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
