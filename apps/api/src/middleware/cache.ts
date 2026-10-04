import type { NextFunction, Request, Response } from 'express';

/**
 * `Cache-Control` on successful GETs only. For public reads that change rarely (the category list, the
 * repair catalogue) — never for anything that depends on who is signed in, and never mounted in front of
 * a router that also serves staff-only routes.
 *
 * `seconds > 0`  → `public, max-age=N`: the browser reuses it without asking for that long.
 * `seconds === 0` → `public, no-cache`: the browser keeps a copy but asks every time (Express's ETag turns
 *                   the answer into a tiny 304 when nothing changed). Use this for anything an admin edits
 *                   and expects customers to see straight away — a phone model, a repair price, a category
 *                   (QA v4 FEAT-01: "changes reflected immediately").
 */
export function cachePublicGets(seconds: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.method === 'GET') {
      const original = res.json.bind(res);
      res.json = (body: unknown) => {
        if (res.statusCode === 200 && !res.hasHeader('Cache-Control')) {
          res.setHeader(
            'Cache-Control',
            seconds > 0 ? `public, max-age=${seconds}` : 'public, no-cache',
          );
        }
        return original(body);
      };
    }
    next();
  };
}
