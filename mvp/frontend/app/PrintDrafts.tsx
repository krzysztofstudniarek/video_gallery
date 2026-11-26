import { createContext, type ReactNode, useContext, useEffect, useRef } from "react";
import { onProviderStop } from "../auth/provider-stop";

type Drafts = {
  read: <T>(key: string) => T | undefined;
  write: (key: string, value: unknown, expiresAt: number) => void;
  remove: (key: string) => void;
};
const Context = createContext<Drafts | null>(null);

// Owned by the signed-in app shell, never storage/history. Only choices belong here:
// destinations, metadata, previews, checklists and download receipts must be revalidated.
export function PrintDrafts({ children }: { children: ReactNode }) {
  const drafts = useRef(
    new Map<string, { value: unknown; expiresAt: number; timer: ReturnType<typeof setTimeout> }>(),
  );
  const api = useRef<Drafts>({
    read: <T,>(key: string) => {
      const draft = drafts.current.get(key);
      if (draft && draft.expiresAt <= Date.now()) api.current.remove(key);
      return drafts.current.get(key)?.value as T | undefined;
    },
    remove: (key) => {
      clearTimeout(drafts.current.get(key)?.timer);
      drafts.current.delete(key);
    },
    write: (key, value, expiresAt) => {
      api.current.remove(key);
      if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return;
      drafts.current.set(key, {
        value,
        expiresAt,
        timer: setTimeout(() => api.current.remove(key), expiresAt - Date.now()),
      });
    },
  });
  useEffect(() => {
    const clear = () => {
      for (const key of drafts.current.keys()) api.current.remove(key);
    };
    const stop = onProviderStop(clear);
    return () => {
      stop();
      clear();
    };
  }, []);
  return <Context.Provider value={api.current}>{children}</Context.Provider>;
}

export function usePrintDrafts() {
  return useContext(Context)!;
}
