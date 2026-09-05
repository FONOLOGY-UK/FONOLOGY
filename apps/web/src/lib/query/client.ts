import { QueryClient, isServer } from '@tanstack/react-query';
import { ApiError } from '@/lib/data/adapters/http.adapter';

/**
 * Retry only what a retry can actually fix.
 *
 * `retry: 1` used to apply to everything, which meant a 403 — "you do not hold
 * this permission" — was asked a second time, and got the same answer. It never
 * could have got a different one. The till was the worst case: opening it as
 * counter staff fires GET /admin/settings and GET /admin/staff, both of which
 * that person is correctly forbidden from, so every single till load spent four
 * requests (two refusals, two pointless retries) before showing anything.
 *
 * That is wasted work on any host and a real problem on a small one, where the
 * page already opens eight requests at once and each one crosses the /api-proxy
 * hop twice. Requests that cannot succeed should not be competing for the same
 * queue as the products list.
 *
 * So: client errors (4xx) are answers, not failures — accept them first time.
 * Server errors, and a connection that never completed (status 0), are worth
 * one more go.
 */
function retryOnlyTransient(failureCount: number, error: unknown): boolean {
  if (failureCount >= 1) return false;
  if (error instanceof ApiError) {
    return error.status === 0 || error.status >= 500;
  }
  return true;
}

/**
 * Query client factory. On the server we always make a fresh client per
 * request; in the browser we reuse a singleton so navigations share cache.
 */
function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60 * 1000, // 1 min — avoids immediate refetch after hydration
        gcTime: 5 * 60 * 1000,
        retry: retryOnlyTransient,
        refetchOnWindowFocus: false,
      },
      mutations: {
        retry: 0,
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined;

export function getQueryClient(): QueryClient {
  if (isServer) return makeQueryClient();
  if (!browserQueryClient) {
    browserQueryClient = makeQueryClient();
    if (process.env.NODE_ENV === 'development') {
      // Debug handle for inspecting query state from the console.
      (window as unknown as Record<string, unknown>).__FONOLOGY_QC = browserQueryClient;
    }
  }
  return browserQueryClient;
}
