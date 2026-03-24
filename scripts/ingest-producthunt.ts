import "dotenv/config";
import axios from "axios";
import { pathToFileURL } from "node:url";
import { readFileSync, writeFileSync } from "node:fs";
import { upsertCompany } from "./_lib/upsert.js";
import { prisma } from "./_lib/prisma.js";

const CHECKPOINT_FILE = new URL("../.ph-checkpoint.json", import.meta.url).pathname;

interface Checkpoint {
  cursor: string | null;
  page: number;
  count: number;
}

function loadCheckpoint(): Checkpoint {
  try {
    return JSON.parse(readFileSync(CHECKPOINT_FILE, "utf8")) as Checkpoint;
  } catch {
    return { cursor: null, page: 0, count: 0 };
  }
}

function saveCheckpoint(cp: Checkpoint): void {
  writeFileSync(CHECKPOINT_FILE, JSON.stringify(cp));
}

const PH_GRAPHQL_URL = "https://api.producthunt.com/v2/api/graphql";

const RECENT_POSTS_QUERY = `
  query RecentPosts($after: String) {
    posts(first: 20, after: $after, order: NEWEST) {
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        node {
          id
          name
          tagline
          website
          topics {
            edges {
              node {
                name
              }
            }
          }
          votesCount
          createdAt
        }
      }
    }
  }
`;

function extractDomain(url: string): string | null {
  try {
    const hostname = new URL(url).hostname;
    return hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

interface PHPageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}

interface PHNode {
  id: string;
  name: string;
  tagline: string;
  website: string | null;
  topics: { edges: Array<{ node: { name: string } }> };
  votesCount: number;
  createdAt: string;
}

interface PHResponse {
  data: {
    posts: {
      pageInfo: PHPageInfo;
      edges: Array<{ node: PHNode }>;
    };
  };
}

export async function ingestProductHunt(): Promise<void> {
  // Accept bearer token from CLI argument (takes precedence) or environment variable.
  const token = process.argv[2] ?? process.env.PRODUCTHUNT_TOKEN;
  if (!token) {
    console.error(
      "PRODUCTHUNT_TOKEN required. Get one at https://api.producthunt.com/v2/docs — NOTE: commercial use requires approval from hello@producthunt.com"
    );
    throw new Error("PRODUCTHUNT_TOKEN is required");
  }

  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - 1);

  const checkpoint = loadCheckpoint();
  let cursor: string | null = checkpoint.cursor;
  let hasNextPage = true;
  let page = checkpoint.page;
  let count = checkpoint.count;

  if (page > 0) {
    console.log(`Resuming from page ${page + 1} (cursor saved), ${count} already ingested`);
  }

  while (hasNextPage) {
    const response = await axios.post<PHResponse>(
      PH_GRAPHQL_URL,
      {
        query: RECENT_POSTS_QUERY,
        variables: { after: cursor },
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      }
    );

    const posts = response.data.data.posts;
    hasNextPage = posts.pageInfo.hasNextPage;
    cursor = posts.pageInfo.endCursor;

    let reachedCutoff = false;
    for (const { node } of posts.edges) {
      if (new Date(node.createdAt) < cutoff) {
        reachedCutoff = true;
        break;
      }

      const extracted = node.website ? extractDomain(node.website) : null;
      const domain = (extracted && extracted !== "producthunt.com") ? extracted : `ph-${node.id}.producthunt`;
      const firstTopic = node.topics.edges[0]?.node.name ?? null;

      try {
        await upsertCompany({
          domain,
          name: node.name,
          oneLiner: node.tagline,
          website: node.website,
          industry: firstTopic,
          source: "producthunt",
          sourceId: node.id,
        });
        count++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`Failed to upsert ${node.name}: ${msg}`);
      }
    }

    page++;
    if (reachedCutoff) {
      saveCheckpoint({ cursor: null, page: 0, count: 0 });
      break;
    }
    saveCheckpoint({ cursor, page, count });
    console.log(`Page ${page} done, ${count} ingested so far...`);
    await new Promise((r) => setTimeout(r, 1000));
  }

  console.log(`Ingested ${count} Product Hunt companies`);
  try { writeFileSync(CHECKPOINT_FILE, JSON.stringify({ cursor: null, page: 0, count: 0 })); } catch {}
  await prisma.$disconnect();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  ingestProductHunt().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
