import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import "./index.css";
import App from "./App.tsx";
import {
  QUERY_GC_TIME,
  queryClient,
  queryPersister,
} from "@/lib/query";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        maxAge: QUERY_GC_TIME,
        persister: queryPersister!,
      }}
    >
      <App />
    </PersistQueryClientProvider>
  </StrictMode>,
);
