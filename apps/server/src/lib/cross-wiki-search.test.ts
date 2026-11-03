import { describe, expect, it } from 'vitest';
import { fuseRankedLists, RRF_K } from './cross-wiki-search';

const id = (hit: string) => hit;

describe('fuseRankedLists', () => {
  it('interleaves disjoint wiki rankings by rank, earlier lists first on ties', () => {
    const groups = fuseRankedLists(
      [
        { wikiId: 'current', hits: ['c1', 'c2', 'c3'] },
        { wikiId: 'other', hits: ['o1'] },
      ],
      id,
      3,
    );
    expect(groups).toEqual([
      { wikiId: 'current', hits: ['c1', 'c2'] },
      { wikiId: 'other', hits: ['o1'] },
    ]);
  });

  it('orders groups by their best fused hit', () => {
    const groups = fuseRankedLists(
      [
        { wikiId: 'current', hits: [] },
        { wikiId: 'a', hits: ['a1'] },
      ],
      id,
      5,
    );
    expect(groups.map((group) => group.wikiId)).toEqual(['a']);
  });

  it('sums reciprocal ranks when lists of one wiki share a hit', () => {
    const groups = fuseRankedLists(
      [
        { wikiId: 'w', hits: ['x', 'y'] },
        { wikiId: 'w', hits: ['y', 'z'] },
        { wikiId: 'v', hits: ['v1'] },
      ],
      id,
      10,
    );
    // y: 1/(k+2) + 1/(k+1) beats x and v1 at 1/(k+1).
    expect(groups[0]).toEqual({ wikiId: 'w', hits: ['y', 'x', 'z'] });
    expect(1 / (RRF_K + 2) + 1 / (RRF_K + 1)).toBeGreaterThan(1 / (RRF_K + 1));
  });

  it('never returns more than the limit', () => {
    const groups = fuseRankedLists([{ wikiId: 'w', hits: ['a', 'b', 'c'] }], id, 2);
    expect(groups.flatMap((group) => group.hits)).toEqual(['a', 'b']);
  });
});
