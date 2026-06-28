import { QueryClient } from "@tanstack/react-query";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";

export const QUERY_STALE_TIME = 30 * 60 * 1000;
export const QUERY_GC_TIME = 24 * 60 * 60 * 1000;
export const QUERY_CACHE_KEY = "tsqr_query_cache_v1";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: QUERY_STALE_TIME,
      gcTime: QUERY_GC_TIME,
      refetchOnMount: false,
      refetchOnReconnect: false,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

export const queryPersister =
  typeof window === "undefined"
    ? undefined
    : createSyncStoragePersister({
        storage: window.localStorage,
        key: QUERY_CACHE_KEY,
      });

const CARD_REQUEST_CONCURRENCY = 6;
let activeCardRequests = 0;
const cardQueue: Array<() => void> = [];

export function limitCardRequest<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const run = () => {
      activeCardRequests++;
      fn()
        .then(resolve, reject)
        .finally(() => {
          activeCardRequests--;
          cardQueue.shift()?.();
        });
    };

    if (activeCardRequests < CARD_REQUEST_CONCURRENCY) run();
    else cardQueue.push(run);
  });
}
