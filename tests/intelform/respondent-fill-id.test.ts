import {describe, expect, it} from 'vitest';

import {submitInput} from '../../src/lib/intelform/api-public';
import {FillId, newSubmissionId} from '../../src/respondent/api';

describe('respondent submissionId (one per fill)', () => {
  it('is 16 random bytes, base64url, accepted by the submit schema', () => {
    const ids = new Set(Array.from({length: 200}, () => newSubmissionId()));
    expect(ids.size).toBe(200);
    for (const id of ids) {
      expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/);
      expect(submitInput.safeParse({formVersionId: '00000000-0000-4000-8000-0000000000a1', answers: {}, renderToken: 't', submissionId: id}).success).toBe(true);
    }
  });

  it('keeps one id across retries of a fill, a new one only after it was saved', () => {
    const fill = new FillId();
    const first = fill.get();
    // A failed or lost submit, pressed again: the same id.
    expect(fill.get()).toBe(first);
    expect(fill.get()).toBe(first);
    fill.done();
    const next = fill.get();
    expect(next).not.toBe(first);
    expect(fill.get()).toBe(next);
  });
});
