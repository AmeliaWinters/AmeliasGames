/**
 * Types for the one file of `qrcode-generator` this imports.
 *
 * The package ships a CJS build, an ESM build, and a `.d.ts` that describes
 * only the first: `export = qrcode`. Rollup resolves the bare specifier to the
 * ESM build, which has no default export, so `import qrcode from
 * "qrcode-generator"` type-checks against the CJS shape and then fails the
 * production build -- and only the production build, because Vitest resolves
 * the CJS one and passes.
 *
 * So the ESM file is imported by path and described here, which makes the two
 * halves agree. Four methods, because four is all `qr.tsx` uses; the package
 * also draws its own tables, img tags and data URLs, none of which we want.
 */
declare module 'qrcode-generator/dist/qrcode.mjs' {
  interface QrCodeHandle {
    addData(data: string, mode?: 'Numeric' | 'Alphanumeric' | 'Byte' | 'Kanji'): void;
    make(): void;
    getModuleCount(): number;
    isDark(row: number, col: number): boolean;
  }
  export const qrcode: (
    typeNumber: number,
    errorCorrectionLevel: 'L' | 'M' | 'Q' | 'H',
  ) => QrCodeHandle;
}
