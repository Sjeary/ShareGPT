declare module 'node-diff3' {
  // a = ours, o = original(base), b = theirs
  export function merge(
    a: string[] | string,
    o: string[] | string,
    b: string[] | string,
    options?: { stringSeparator?: string | RegExp },
  ): { conflict: boolean; result: string[] }
}
