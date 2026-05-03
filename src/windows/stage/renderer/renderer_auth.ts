import type express from "express";

export interface RendererTokenOptions {
  enabled?: boolean;
  requireToken?: boolean;
  token?: string;
}

export function allowDebugRequest(
  options: RendererTokenOptions | undefined,
  req: express.Request,
  res: express.Response,
): boolean {
  if (!options?.enabled) {
    res.status(404).json({ ok: false, error: "debug disabled" });
    return false;
  }
  if (isLocalRequest(req)) return true;
  return allowTokenRequest(options, req, res, "debug");
}

export function allowControlRequest(
  options: RendererTokenOptions | undefined,
  req: express.Request,
  res: express.Response,
): boolean {
  return allowTokenRequest(options, req, res, "control");
}

function allowTokenRequest(
  options: RendererTokenOptions | undefined,
  req: express.Request,
  res: express.Response,
  label: "debug" | "control",
): boolean {
  if (options?.requireToken === false) return true;
  const expected = options?.token;
  if (!expected) {
    res.status(403).json({ ok: false, error: `${label} token is required but not configured` });
    return false;
  }
  const header = req.header("authorization")?.replace(/^Bearer\s+/i, "");
  const query = typeof req.query.token === "string" ? req.query.token : undefined;
  if (header === expected || query === expected) return true;
  res.status(401).json({ ok: false, error: `invalid ${label} token` });
  return false;
}

function isLocalRequest(req: express.Request): boolean {
  const candidates = [
    req.ip,
    req.socket.remoteAddress,
    req.connection.remoteAddress,
    req.header("x-forwarded-for")?.split(",")[0]?.trim(),
  ].filter((value): value is string => Boolean(value));

  return candidates.some((address) => ["127.0.0.1", "::1", "::ffff:127.0.0.1", "localhost"].includes(address));
}
