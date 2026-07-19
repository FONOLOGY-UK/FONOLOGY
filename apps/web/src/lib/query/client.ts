import { QueryClient, isServer } from '@tanstack/react-query';

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
        retry: 1,
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
