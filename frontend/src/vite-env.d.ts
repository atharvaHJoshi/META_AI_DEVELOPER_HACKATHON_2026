/// <reference types="vite/client" />

import type { UserConfig } from "vite";

declare module "vite" {
  interface UserConfig {
    test?: {
      environment: string;
      setupFiles?: string | string[];
      css?: boolean;
    };
  }
}
