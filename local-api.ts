import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { config as dotenvConfig } from "dotenv";

// Load .env.local first, then .env (so .env.local takes precedence)
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenvConfig({ path: resolve(__dirname, ".env.local") });
dotenvConfig({ path: resolve(__dirname, ".env") });

import express from "express";
import { createServer } from "http";

const routes: Record<string, string> = {
  "/api/health": "./api/health.ts",
  "/api/profile": "./api/profile.ts",
  "/api/companies": "./api/companies.ts",
  "/api/contacts": "./api/contacts.ts",
  "/api/custom-contacts": "./api/custom-contacts.ts",
  "/api/leads": "./api/leads.ts",
  "/api/emails": "./api/emails.ts",
  "/api/emails/generate": "./api/emails/generate.ts",
  "/api/emails/send": "./api/emails/send.ts",
  "/api/templates": "./api/templates.ts",
  "/api/sequences": "./api/sequences.ts",
  "/api/campaigns": "./api/campaigns.ts",
  "/api/campaign-batch": "./api/campaign-batch.ts",
  "/api/campaign-leads": "./api/campaign-leads.ts",
  "/api/campaign-options": "./api/campaign-options.ts",
  "/api/apollo-search": "./api/apollo-search.ts",
  "/api/industries": "./api/industries.ts",
};

async function loadHandler(filePath: string) {
  const mod = await import(filePath);
  return mod.default;
}

async function buildHandlers() {
  const handlers: Record<string, any> = {};
  for (const [route, filePath] of Object.entries(routes)) {
    try {
      handlers[route] = await loadHandler(resolve(__dirname, filePath));
      console.log(`✓ Loaded ${route}`);
    } catch (err: any) {
      console.warn(`✗ Skipped ${route}: ${err.message}`);
    }
  }
  return handlers;
}

function wrapHandler(handler: (req: any, res: any) => Promise<void>) {
  return async (req: express.Request, res: express.Response) => {
    const vercelReq = {
      method: req.method,
      url: req.url,
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
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  const handlers = await buildHandlers();

  for (const [route, handler] of Object.entries(handlers)) {
    app.all(route, wrapHandler(handler));
  }

  app.use((_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  const PORT = process.env.PORT || 3000;

  createServer(app).listen(PORT, () => {
    console.log(`\n🚀 Local API server running at http://localhost:${PORT}`);
    console.log(`   Health check: http://localhost:${PORT}/api/health`);
    console.log(`   ${Object.keys(handlers).length} route(s) loaded\n`);
  });
}

start().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
