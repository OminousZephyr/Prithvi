declare module 'jpeg-js' {
  export interface DecodedJPEG { width: number; height: number; data: Uint8Array }
  export function decode(data: Uint8Array, options?: { useTArray?: boolean; formatAsRGBA?: boolean; maxMemoryUsageInMB?: number; maxResolutionInMP?: number; tolerantDecoding?: boolean }): DecodedJPEG;
  export function encode(image: { data: Uint8Array; width: number; height: number }, quality?: number): { data: Uint8Array; width: number; height: number };
  const jpeg: { decode: typeof decode; encode: typeof encode };
  export default jpeg;
}
