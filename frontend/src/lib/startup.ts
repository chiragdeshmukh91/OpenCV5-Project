/**
 * Every open or refresh begins at the start / overview screen, never at a stale mid-workflow view
 * (the URL hash of a previous session, an old incident). Only this temporary UI state is reset:
 * backend runs, run history and the session run list are untouched.
 */
export function initialPage<T extends string>(start: T): T {
  const target = `#/${start}`;
  if (window.location.hash !== target) window.history.replaceState(null, '', target);
  return start;
}
