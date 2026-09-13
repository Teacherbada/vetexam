"use client";

import { useEffect, useState } from "react";

export type AvailabilityRow = { subject: string; year: number | null; count: number };
export type ChapterCount = AvailabilityRow & { chapter: string | null };

// Subject totals and chapter ranks share one public settings request.
export function useHomeAvailability() {
  const [data, setData] = useState<{ availability: AvailabilityRow[]; chapterAvailability: ChapterCount[] } | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/quiz?scope=public&settings=1&chapters=1", {
      cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]),
    }).then(async response => {
      if (!response.ok) throw new Error("Unable to load public availability");
      const result = await response.json();
      if (!Array.isArray(result.availability) || !Array.isArray(result.chapterAvailability)) throw new Error("Invalid availability");
      if (!controller.signal.aborted) setData(result);
    }).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [attempt]);
  return { data, error, retry: () => { setError(false); setData(null); setAttempt(value => value + 1); } };
}
