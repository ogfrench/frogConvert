declare module "upng-js" {
  export function encode(
    imgs: ArrayBuffer[] | Uint8Array[],
    w: number,
    h: number,
    cnum: number,
    dels?: number[]
  ): ArrayBuffer;
}
