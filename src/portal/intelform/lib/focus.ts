/**
 * Keeping keyboard focus where the person was (WCAG 2.4.3). When the focused element is
 * removed (a deleted question, a dialog unmounted while open), moved in the DOM (a reorder) or
 * disabled (a button that becomes "Published"), the browser drops focus to <body> and the next
 * Tab starts from the top of the page. These helpers put it back on a sensible element.
 */

type FocusDoc = {activeElement: Element | null; body: Element | null};
type Focusable = {focus(options?: FocusOptions): void};

/** True when nothing useful has focus: <body>, nothing at all, or an element no longer in the page. */
export function focusIsLost(doc: FocusDoc = document): boolean {
  const active = doc.activeElement;
  return !active || active === doc.body || !active.isConnected;
}

/**
 * On the next frame (after React commits and a dialog closes), focus `target()` if focus was lost.
 * Never steals focus from an element the person (or another handler) has moved to.
 *
 * `frames` keeps watching for that many frames, putting focus back each time it is lost again: a
 * drag-and-drop drop re-orders the DOM a frame or two after the drop event (the library puts the
 * dragged node back, then React moves it), and moving a focused node drops focus to <body> again.
 */
export function restoreFocusIfLost(
  target: () => Focusable | null | undefined,
  env: {doc?: FocusDoc; frame?: (cb: () => void) => unknown; frames?: number} = {}
): void {
  const frame = env.frame ?? ((cb: () => void) => requestAnimationFrame(cb));
  let left = Math.max(1, env.frames ?? 1);
  const check = () => {
    if (focusIsLost(env.doc ?? document)) target()?.focus({preventScroll: false});
    if (--left > 0) frame(check);
  };
  frame(check);
}

/** How long (in frames, about half a second) a drop is watched: the drop animation and React's re-order. */
export const DROP_FOCUS_FRAMES = 30;

/**
 * After one id leaves an ordered list, the id to move focus to: the item now in its place (the
 * next one), else the one before it. `null` when the list is now empty; `undefined` when nothing
 * was removed.
 */
export function neighbourAfterRemoval(before: readonly string[], after: readonly string[]): string | null | undefined {
  const kept = new Set(after);
  const i = before.findIndex(id => !kept.has(id));
  if (i < 0) return undefined;
  for (let j = i + 1; j < before.length; j++) if (kept.has(before[j])) return before[j];
  for (let j = i - 1; j >= 0; j--) if (kept.has(before[j])) return before[j];
  return null;
}

/**
 * The control to focus when `button` can no longer take focus (it became disabled): itself when
 * still enabled, else the nearest enabled button or link before it in `scope`, else after it.
 */
export function nearestEnabledControl(button: HTMLElement | null, scope: ParentNode | null): HTMLElement | null {
  if (!button) return null;
  if (!(button as HTMLButtonElement).disabled) return button;
  if (!scope) return null;
  const controls = [...scope.querySelectorAll<HTMLElement>('button, a[href]')];
  const enabled = (el: HTMLElement) => !(el as HTMLButtonElement).disabled;
  const at = controls.indexOf(button);
  for (let j = at - 1; j >= 0; j--) if (enabled(controls[j])) return controls[j];
  return controls.slice(at + 1).find(enabled) ?? null;
}
