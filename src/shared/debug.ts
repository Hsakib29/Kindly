// Debug logging (P8.x): everything is gated behind the `debug` setting
// (default OFF) and a build-time strip flag.
//
// STRIP_DEBUG_LOGS: set to true for release builds to disable all debug
// output without removing call sites. For a harder strip, dead-code
// elimination can drop these calls entirely in a minified build.

import { getSettings } from './storage';

export const STRIP_DEBUG_LOGS = false;

let runtimeEnabled = false;

export function setDebugEnabled(enabled: boolean) {
  runtimeEnabled = enabled;
}

/** Call once at startup and whenever settings change. */
export async function refreshDebugEnabled(): Promise<void> {
  try {
    const settings = await getSettings();
    runtimeEnabled = settings.debug;
  } catch {
    runtimeEnabled = false;
  }
}

export function debugEnabled(): boolean {
  return !STRIP_DEBUG_LOGS && runtimeEnabled;
}

export function debugLog(...args: unknown[]) {
  if (debugEnabled()) console.log('[Kindly]', ...args);
}

export function debugGroup(label: string) {
  if (debugEnabled()) console.groupCollapsed(`[Kindly] ${label}`);
}

export function debugGroupEnd() {
  if (debugEnabled()) console.groupEnd();
}
