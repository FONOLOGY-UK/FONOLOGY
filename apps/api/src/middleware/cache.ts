import type { NextFunction, Request, Response } from 'express';

/**
 * `Cache-Control: public, max-age=…` on successful GETs only. For public reads that change rarely
 * (the category list, the repair catalogue) — never for anything that depends on who is signed in,
 * and never mounted in front of a router that also serves staff-only routes.
 */
export function cachePublicGets(seconds: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.method === 'GET') {
      const original = res.json.bind(res);
      res.json = (body: unknown) => {
        if (res.statusCode === 200 && !res.hasHeader('Cache-Control')) {
          res.setHeader('Cache-Control', `public, max-age=${seconds}`);
        }
        return original(body);
      };
    }
    next();
  };
}
