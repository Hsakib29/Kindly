// Shared host matching for hidden-sites, never-run list and the popup
// toggle. One rule everywhere: a pattern matches the exact host and all
// of its subdomains. Hosts are compared without a leading "www.".

/** Normalize a hostname: lowercase, strip a single leading "www.". */
export function normalizeHost(host: string): string {
  const h = host.trim().toLowerCase();
  return h.startsWith('www.') ? h.slice(4) : h;
}

/** True when `pattern` equals `host` or is a parent domain of it. */
export function hostMatches(pattern: string, host: string): boolean {
  const p = normalizeHost(pattern);
  const h = normalizeHost(host);
  if (!p || !h) return false;
  return h === p || h.endsWith('.' + p);
}

/** True when any pattern in the list matches the host. */
export function hostBlocked(patterns: Iterable<string>, host: string): boolean {
  for (const p of patterns) if (hostMatches(p, host)) return true;
  return false;
}

import { DEFAULT_NEVER_RUN_SITES } from './messages';

/**
 * Effective never-run list: built-in defaults are ALWAYS enforced —
 * the user can add sites but cannot remove the defaults. Used by both
 * the content script and the service worker so they can never disagree.
 */
export function effectiveNeverRunSites(userSites: Iterable<string>): string[] {
  const out = [...DEFAULT_NEVER_RUN_SITES];
  for (const s of userSites) {
    const n = normalizeHost(s);
    if (n && !out.includes(n)) out.push(n);
  }
  return out;
}
