import { expect, it } from 'vitest';
import { markdownReferences, remoteImageSources, replaceImportReferences } from './import-references';

const references = (source: string) => markdownReferences(source).map(({ value, image }) => ({ value, image }));

it('reads an image inside a link label before the link itself', () => {
  expect(references('[![Badge](b.png)](https://x.io)')).toEqual([
    { value: 'b.png', image: true },
    { value: 'https://x.io', image: false },
  ]);
  expect(remoteImageSources('[![Badge](https://x.io/b.png)](https://x.io)')).toEqual(['https://x.io/b.png']);
});

it('rewrites nested references without moving the text around them', () => {
  const source = 'a [![Badge](b.png "t")](<c d.md>) e';
  expect(replaceImportReferences(source, markdownReferences(source), ({ value }) => value.toUpperCase())).toBe('a [![Badge](B.PNG "t")](<C D.MD>) e');
});

it('treats everything inside a destination as that destination', () => {
  expect(references('[a](b[c](d)e) [f](g)')).toEqual([
    { value: 'b[c](d)e', image: false },
    { value: 'g', image: false },
  ]);
});

it('reads crossed pairs once, without overlapping references', () => {
  const depth = 4;
  const found = markdownReferences(`${'['.repeat(depth)}${']('.repeat(depth)}x${')'.repeat(depth)}`);
  expect(found).toHaveLength(1);
});

it('ends an angle destination at its own parenthesis', () => {
  expect(references('[a](<b) and [c](d>) [e](<f g>)')).toEqual([
    { value: 'd>', image: false },
    { value: 'f g', image: false },
  ]);
});
