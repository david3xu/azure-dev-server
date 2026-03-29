// How are requests authenticated?

import type { Request, Response } from "express";

export function checkApiKey(req: Request, res: Response, apiKey: string): boolean {
  const provided = req.headers["x-api-key"] ?? req.query["key"];
  if (provided !== apiKey) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }
  return true;
}
