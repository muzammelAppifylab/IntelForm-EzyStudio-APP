import {readFileSync} from 'node:fs';

import {describe, expect, it, vi} from 'vitest';

import {focusIsLost, nearestEnabledControl, neighbourAfterRemoval, restoreFocusIfLost} from '../../src/portal/intelform/lib/focus';

/**
 * F-043: focus fell to <body> after closing contact Filters, a keyboard reorder, deleting a
 * question and publishing. The suite has no browser, so the decisions are tested here and the
 * wiring at each place is pinned by the source checks at the end.
 */
const el = (name: string, extra: Record<string, unknown> = {}) => ({name, isConnected: true, focus: vi.fn(), ...extra});

describe('focusIsLost', () => {
  const body = el('body');
  it('is lost on body, on nothing, and on an element removed from the page', () => {
    expect(focusIsLost({activeElement: body as never, body: body as never})).toBe(true);
    expect(focusIsLost({activeElement: null, body: body as never})).toBe(true);
    expect(focusIsLost({activeElement: el('gone', {isConnected: false}) as never, body: body as never})).toBe(true);
  });
  it('is kept on a connected element', () => {
    expect(focusIsLost({activeElement: el('button') as never, body: body as never})).toBe(false);
  });
});

describe('restoreFocusIfLost', () => {
  const body = el('body');
  const run = (active: unknown, target: ReturnType<typeof el> | null) => {
    let frame: (() => void) | undefined;
    restoreFocusIfLost(() => target, {doc: {activeElement: active as never, body: body as never}, frame: cb => (frame = cb)});
    if (target) expect(target.focus).not.toHaveBeenCalled(); // waits for the next frame
    frame!();
  };
  it('focuses the target on the next frame when focus fell to body', () => {
    const target = el('Filters');
    run(body, target);
    expect(target.focus).toHaveBeenCalledOnce();
  });
  it('never steals focus the person already moved', () => {
    const target = el('Filters');
    run(el('search'), target);
    expect(target.focus).not.toHaveBeenCalled();
  });
  it('does nothing when the target is gone', () => {
    expect(() => run(body, null)).not.toThrow();
  });
  it('with `frames`, puts focus back again when a later re-order drops it a second time (a keyboard drop)', () => {
    // Seen in Chrome: the drop focuses the handle, then React moves the card's node a frame later
    // and focus falls to <body> again. One frame of watching was not enough.
    const handle = el('handle');
    const doc = {activeElement: body as unknown, body: body as never};
    handle.focus.mockImplementation(() => (doc.activeElement = handle));
    const queue: (() => void)[] = [];
    restoreFocusIfLost(() => handle, {doc: doc as never, frame: cb => queue.push(cb), frames: 5});
    queue.shift()!();
    expect(doc.activeElement).toBe(handle);
    doc.activeElement = body; // the re-order
    queue.shift()!();
    expect(handle.focus).toHaveBeenCalledTimes(2);
    expect(doc.activeElement).toBe(handle);
    const search = el('search');
    doc.activeElement = search; // the person moved on: never taken back
    while (queue.length) queue.shift()!();
    expect(handle.focus).toHaveBeenCalledTimes(2);
    expect(doc.activeElement).toBe(search);
  });
  it('stops watching after `frames` frames', () => {
    const queue: (() => void)[] = [];
    restoreFocusIfLost(() => el('x'), {doc: {activeElement: body as never, body: body as never}, frame: cb => queue.push(cb), frames: 3});
    let n = 0;
    while (queue.length) {
      queue.shift()!();
      n++;
    }
    expect(n).toBe(3);
  });
});

describe('neighbourAfterRemoval (question Delete)', () => {
  it('moves to the question now in its place', () => {
    expect(neighbourAfterRemoval(['a', 'b', 'c'], ['a', 'c'])).toBe('c');
    expect(neighbourAfterRemoval(['a', 'b', 'c'], ['b', 'c'])).toBe('b');
  });
  it('moves to the one before when the last was deleted', () => {
    expect(neighbourAfterRemoval(['a', 'b', 'c'], ['a', 'b'])).toBe('b');
  });
  it('is null when no question is left, undefined when none was removed', () => {
    expect(neighbourAfterRemoval(['a'], [])).toBeNull();
    expect(neighbourAfterRemoval(['a', 'b'], ['b', 'a'])).toBeUndefined();
  });
});

describe('nearestEnabledControl (Publish)', () => {
  const scope = (...items: ReturnType<typeof el>[]) => ({querySelectorAll: () => items}) as unknown as ParentNode;
  it('keeps the button itself while it is enabled', () => {
    const publish = el('Publish', {disabled: false});
    expect(nearestEnabledControl(publish as never, scope(el('Preview'), publish))).toBe(publish);
  });
  it('moves to the enabled control before a disabled "Published" button', () => {
    const preview = el('Preview', {disabled: false});
    const publish = el('Published', {disabled: true});
    expect(nearestEnabledControl(publish as never, scope(el('Back', {disabled: false}), preview, publish))).toBe(preview);
  });
  it('falls back to one after it, else nothing', () => {
    const publish = el('Published', {disabled: true});
    const after = el('More', {disabled: false});
    expect(nearestEnabledControl(publish as never, scope(publish, after))).toBe(after);
    expect(nearestEnabledControl(publish as never, scope(publish))).toBeNull();
  });
});

describe('focus restoration is wired at each place the audit found', () => {
  const src = (p: string) => readFileSync(p, 'utf8');
  it('contact Filters returns focus to its button when the drawer closes', () => {
    expect(src('src/portal/intelform/contacts/Filters.tsx')).toMatch(/if \(wasOpen\.current && !open\) restoreFocusIfLost\(\(\) => opener\.current\)/);
  });
  it('a keyboard reorder returns focus to the moved card’s handle, dropped or cancelled', () => {
    const build = src('src/portal/screens/builder/build.tsx');
    expect(build).toMatch(/if \(source && isSortable\(source\)\) refocusHandle\(String\(source\.id\)\);\s*if \(event\.canceled\) return;/);
    expect(build).toContain('.if-drag-handle');
    // Watched past the re-order React does after the drop, in the canvas and in option lists.
    expect(build).toMatch(/frames: DROP_FOCUS_FRAMES/);
    expect(src('src/portal/intelform/builder/OptionsEditor.tsx')).toMatch(/frames: DROP_FOCUS_FRAMES/);
  });
  it('deleting a question moves focus to its neighbour', () => {
    expect(src('src/portal/intelform/builder/build/Canvas.tsx')).toMatch(/useFocusAfterRemoval\(draft\.fields\)/);
  });
  it('publishing returns focus to an enabled header control', () => {
    expect(src('src/portal/intelform/builder/PublishButton.tsx')).toMatch(/finally \{[\s\S]*restoreFocusIfLost\(\(\) => nearestEnabledControl\(/);
  });
});
