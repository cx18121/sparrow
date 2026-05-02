import type { VercelRequest, VercelResponse } from "@vercel/node";
import { dispatchApiRequest } from "../server/router.js";

export default function handler(req: VercelRequest, res: VercelResponse) {
  return dispatchApiRequest(req, res);
}
