import { describe, expect, it } from 'vitest';
import { reviewSummary } from './change-request-reviews';

const at = (day: number) => new Date(Date.UTC(2026, 9, day));
const reviewer = (userId: string, day = 1) => ({ userId, requestedAt: at(day) });
const review = (authorId: string, state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED', day: number) => ({ authorId, state, createdAt: at(day) });

describe('reviewSummary', () => {
  it('counts the latest verdict of each reviewer', () => {
    const summary = reviewSummary({
      reviewers: [reviewer('a'), reviewer('b')],
      reviews: [review('a', 'CHANGES_REQUESTED', 2), review('a', 'APPROVED', 3), review('b', 'APPROVED', 2)],
      required: 2,
    });
    expect(summary).toMatchObject({ approvals: 2, changesRequested: 0, mergeable: true });
  });

  it('keeps a verdict through later comments', () => {
    const summary = reviewSummary({ reviewers: [reviewer('a')], reviews: [review('a', 'APPROVED', 2), review('a', 'COMMENTED', 3)], required: 1 });
    expect(summary.mergeable).toBe(true);
    expect(summary.reviewers[0]?.state).toBe('APPROVED');
  });

  it('blocks on an outstanding change request despite enough approvals', () => {
    const summary = reviewSummary({
      reviewers: [reviewer('a'), reviewer('b')],
      reviews: [review('a', 'APPROVED', 2), review('b', 'CHANGES_REQUESTED', 2)],
      required: 1,
    });
    expect(summary).toMatchObject({ approvals: 1, changesRequested: 1, mergeable: false });
  });

  it('ignores reviews from people who are not reviewers', () => {
    const summary = reviewSummary({ reviewers: [], reviews: [review('a', 'CHANGES_REQUESTED', 2)], required: 0 });
    expect(summary).toMatchObject({ approvals: 0, changesRequested: 0, mergeable: true });
  });

  it('needs the required approvals', () => {
    expect(reviewSummary({ reviewers: [reviewer('a')], reviews: [], required: 1 }).mergeable).toBe(false);
  });

  it('awaits a review requested after the reviewer last reviewed', () => {
    const summary = reviewSummary({
      reviewers: [reviewer('a', 3), reviewer('b', 1)],
      reviews: [review('a', 'APPROVED', 2), review('b', 'COMMENTED', 2)],
      required: 1,
    });
    expect(summary.reviewers.map(({ userId, awaiting }) => [userId, awaiting])).toEqual([
      ['a', true],
      ['b', false],
    ]);
  });
});
