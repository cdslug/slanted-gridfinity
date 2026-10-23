/**
 * tool-action.js: tell the host page what was used, as a `tool-action`
 * event on `document`. The app itself sends nothing anywhere; a site that
 * hosts it can listen for these to count usage (README, "Embedding").
 *
 * `once` asks the listener to count an action and detail pair only once per
 * page load, for things like opening help where repeats add nothing.
 */
export function toolAction(action, detail = null, { once = false } = {}) {
  document.dispatchEvent(new CustomEvent('tool-action', {
    detail: { action, detail, once },
  }));
}
