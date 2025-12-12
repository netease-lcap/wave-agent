declare module "fs/promises" {
  import { Dirent } from "fs";

  interface GlobOptionsBase {
    cwd?: string;
    exclude?: string | string[];
  }

  interface GlobOptionsWithFileTypes extends GlobOptionsBase {
    withFileTypes: true;
  }

  interface GlobOptionsWithoutFileTypes extends GlobOptionsBase {
    withFileTypes?: false;
  }

  export function glob(
    pattern: string,
    options: GlobOptionsWithFileTypes,
  ): AsyncIterable<Dirent>;
  export function glob(
    pattern: string,
    options?: GlobOptionsWithoutFileTypes,
  ): AsyncIterable<string>;
}
