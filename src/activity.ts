import type { PasskeyActivityAction, PasskeyActivityEvent } from "./types";

/**
 * Build one `AgentActivity`-shaped event.
 *
 * Kept in one place so every surface stamps the same shape — a presence or undo
 * layer subscribing to these should never have to special-case which component
 * emitted.
 */
export function activityEvent(
  surface: string,
  action: PasskeyActivityAction,
  target?: string,
  detail?: Record<string, unknown>,
): PasskeyActivityEvent {
  const event: PasskeyActivityEvent = { surface, action, at: new Date().toISOString() };
  if (target !== undefined) event.target = target;
  if (detail !== undefined) event.detail = detail;
  return event;
}

/** `2026-07-31T09:12:00Z` → `2026-07-31`, without dragging in a locale. */
export function isoDate(value: string): string {
  return value.length >= 10 ? value.slice(0, 10) : value;
}
