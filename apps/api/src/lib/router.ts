import { Router, type NextFunction, type Request, type Response } from 'express';

/**
 * Async-safe Express routing.
 * =========================================================================
 * Express 4 does not await route handlers. It calls a handler and ignores the
 * returned promise, so a rejection inside an `async` handler never reaches the
 * error middleware — it escapes as an unhandled rejection, and Node's default
 * is to kill the process. In this app that means one bad request takes the
 * whole API down: every till in the shop, mid-shift.
 *
 * Nothing about that is hypothetical — it happened during a verification run.
 *
 * The fix is to route rejections into `next(err)` so they land in the error
 * middleware like any other failure. Rather than hand-writing try/catch into
 * every handler (which only works until someone forgets), `createRouter()`
 * returns a Router that wraps handlers as they are REGISTERED. A handler
 * cannot be added to one of these routers without being wrapped, so the
 * guarantee holds for code not yet written.
 *
 * Express 5 does this natively. When this app moves to it, this file can go.
 */

/** Marks an already-wrapped function so double registration can't double-wrap. */
const WRAPPED = Symbol('fonology.asyncWrapped');

/**
 * Any Express handler shape, called with whatever Express passes.
 *
 * Deliberately `unknown[]`/`unknown` rather than `Function`: this wrapper is
 * variadic over the several handler signatures Express accepts ((req, res),
 * (req, res, next), (err, req, res, next)), so it genuinely cannot name its
 * parameters — but `Function` gives up return typing too and makes every call
 * through it unchecked. This keeps the looseness confined to the arguments.
 */
type AnyHandler = (...args: unknown[]) => unknown;

/**
 * Express Routers and sub-apps are themselves functions, so they arrive at
 * `.use()` looking exactly like middleware. Wrapping one would replace the
 * router object (and its `.stack`, which Express walks) with a plain closure,
 * quietly breaking every route mounted under it.
 */
function isRouterLike(fn: unknown): boolean {
  const candidate = fn as { stack?: unknown; handle?: unknown };
  return Array.isArray(candidate.stack) || typeof candidate.handle === 'function';
}

/**
 * Calls the handler and sends any failure to `next`.
 *
 * The handler is invoked synchronously — not deferred behind
 * `Promise.resolve().then()` — so sync handlers behave exactly as they did
 * before, with no extra microtask between request and response. A `.catch` is
 * only attached when the handler actually returns a promise.
 */
function invoke(fn: AnyHandler, args: unknown[], next: NextFunction): void {
  let result: unknown;
  try {
    result = fn(...args);
  } catch (err) {
    // A synchronous throw. Express already handles these, but routing it the
    // same way keeps one path for both.
    next(err);
    return;
  }
  if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
    Promise.resolve(result).catch(next);
  }
}

/**
 * Wraps one handler. Arity is preserved deliberately: Express decides whether
 * something is an ERROR handler by checking `fn.length === 4`, so a 4-arg
 * error handler has to stay 4-arg or it silently becomes normal middleware and
 * stops seeing errors at all.
 */
export function wrapHandler<T>(fn: T): T {
  if (typeof fn !== 'function') return fn;
  const candidate = fn as unknown as AnyHandler & { [WRAPPED]?: boolean };
  if (candidate[WRAPPED] || isRouterLike(fn)) return fn;

  const wrapped =
    candidate.length >= 4
      ? function (err: unknown, req: Request, res: Response, next: NextFunction) {
          invoke(candidate, [err, req, res, next], next);
        }
      : function (req: Request, res: Response, next: NextFunction) {
          invoke(candidate, [req, res, next], next);
        };

  Object.defineProperty(wrapped, 'name', { value: candidate.name, configurable: true });
  (wrapped as unknown as { [WRAPPED]: boolean })[WRAPPED] = true;
  return wrapped as unknown as T;
}

/** Handlers can be passed singly, as arrays, or mixed with a path string. */
function wrapArg(arg: unknown): unknown {
  if (Array.isArray(arg)) return arg.map(wrapArg);
  if (typeof arg === 'function') return wrapHandler(arg);
  return arg;
}

const ROUTE_METHODS = [
  'all',
  'get',
  'post',
  'put',
  'patch',
  'delete',
  'options',
  'head',
  'use',
] as const;

/**
 * A Router that wraps every handler registered on it.
 *
 * Drop-in for `Router()` — same API, same behaviour, except a rejected promise
 * becomes a 500 through the error middleware instead of killing the process.
 */
export function createRouter(): Router {
  const router = Router();
  for (const method of ROUTE_METHODS) {
    const original = (router[method] as AnyHandler).bind(router);
    (router as unknown as Record<string, unknown>)[method] = (...args: unknown[]) =>
      original(...args.map(wrapArg));
  }
  return router;
}
