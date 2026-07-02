import { useEffect, useState } from "react";
import type { Session } from "@synonymdev/pubky";
import {
  parseSearchKey,
  subscribePrivateEvents,
  subscribeUserEvents,
  toSearchEvent,
  type SearchEvent,
} from "./searchPubky";

export type SearchStreamStatus = "idle" | "connecting" | "streaming" | "error";

interface SearchAuthContext {
  session: Session | null;
  sessionUserZ32: string | null;
}

/** Newest-first: cursors are monotonic ids, so compare numerically descending. */
function byCursorDesc(a: SearchEvent, b: SearchEvent): number {
  const na = Number(a.cursor);
  const nb = Number(b.cursor);
  if (Number.isNaN(na) || Number.isNaN(nb)) {
    return String(b.cursor).localeCompare(String(a.cursor));
  }
  return nb - na;
}

function mergeEvent(prev: SearchEvent[], event: SearchEvent): SearchEvent[] {
  if (prev.some((e) => e.cursor === event.cursor)) return prev;
  return [...prev, event].sort(byCursorDesc);
}

export function useSearchEventStream(
  activeKey: string | null,
  auth: SearchAuthContext
) {
  const { session, sessionUserZ32 } = auth;
  const [status, setStatus] = useState<SearchStreamStatus>("idle");
  const [events, setEvents] = useState<SearchEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [privError, setPrivError] = useState<string | null>(null);
  const [searchedKey, setSearchedKey] = useState<string | null>(null);

  // Only the owner of a key can read its private events, so the priv stream is
  // opened solely when the signed-in session matches the searched key.
  const trimmedKey = activeKey?.trim() ?? "";
  const canReadPriv =
    !!session && !!sessionUserZ32 && sessionUserZ32 === trimmedKey;

  useEffect(() => {
    if (!trimmedKey) {
      setStatus("idle");
      setEvents([]);
      setError(null);
      setPrivError(null);
      setSearchedKey(null);
      return;
    }

    let cancelled = false;
    const cleanups: Array<() => void> = [];

    setStatus("connecting");
    setEvents([]);
    setError(null);
    setPrivError(null);
    setSearchedKey(trimmedKey);

    const onEvent = (event: SearchEvent) => {
      if (cancelled) return;
      setStatus("streaming");
      setEvents((prev) => mergeEvent(prev, event));
    };

    try {
      const user = parseSearchKey(trimmedKey);

      // Public stream via the SDK live interface. Failures are fatal for the view.
      void subscribeUserEvents(
        user,
        (event) => onEvent(toSearchEvent(event)),
        (streamError) => {
          if (cancelled) return;
          setError(streamError.message);
          setStatus("error");
        }
      )
        .then((unsubscribe) => {
          if (cancelled) {
            unsubscribe();
            return;
          }
          cleanups.push(unsubscribe);
          if (!cancelled) setStatus("streaming");
        })
        .catch((e) => {
          if (cancelled) return;
          setError(e instanceof Error ? e.message : "Search failed");
          setStatus("error");
        });

      // Private stream via raw live fetch, only for the authenticated owner. Its
      // failures are soft — surfaced via privError without breaking public results.
      if (canReadPriv && sessionUserZ32) {
        void subscribePrivateEvents(sessionUserZ32, onEvent, (streamError) => {
          if (cancelled) return;
          setPrivError(streamError.message);
        })
          .then((unsubscribe) => {
            if (cancelled) {
              unsubscribe();
              return;
            }
            cleanups.push(unsubscribe);
          })
          .catch((e) => {
            if (cancelled) return;
            setPrivError(
              e instanceof Error ? e.message : "Private events unavailable"
            );
          });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invalid public key");
      setStatus("error");
    }

    return () => {
      cancelled = true;
      for (const cleanup of cleanups) cleanup();
    };
  }, [trimmedKey, canReadPriv, sessionUserZ32]);

  return { status, events, error, privError, searchedKey };
}
