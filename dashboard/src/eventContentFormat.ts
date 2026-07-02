import type { EventContentResult } from "./pubky";

export function formatContent(result: EventContentResult): string {
  const body = result.body ?? "";
  const isJson =
    result.contentType?.includes("json") || /^\s*[[{]/.test(body);
  if (isJson) {
    try {
      return JSON.stringify(JSON.parse(body), null, 2);
    } catch {
      // Fall through to raw body when it isn't actually valid JSON.
    }
  }
  return body;
}
