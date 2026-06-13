import type { IncomingMessage } from "node:http";
import type { NextFunction, Request, Response } from "express";
import type { Env } from "@edgar-eye/shared";

export function createApiAuthMiddleware(env: Env) {
  if (!env.API_SECRET_KEY) {
    return (_req: Request, _res: Response, next: NextFunction) => next();
  }

  return (req: Request, res: Response, next: NextFunction) => {
    if (req.path === "/api/health") {
      next();
      return;
    }

    const provided = req.header("x-api-key");
    if (provided !== env.API_SECRET_KEY) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    next();
  };
}

export function isAuthorizedWebSocketUpgrade(
  env: Env,
  request: IncomingMessage,
): boolean {
  if (!env.API_SECRET_KEY) {
    return true;
  }

  const headerKey = request.headers["x-api-key"];
  if (typeof headerKey === "string" && headerKey === env.API_SECRET_KEY) {
    return true;
  }

  const url = new URL(request.url ?? "", "http://localhost");
  const token = url.searchParams.get("token");
  return token === env.API_SECRET_KEY;
}
