/** jsdom ships no types — declare the part used to give DOMPurify a window. */
declare module 'jsdom' {
  export class JSDOM {
    constructor(html?: string);
    readonly window: { XMLSerializer: new () => { serializeToString(node: never): string } };
  }
}
