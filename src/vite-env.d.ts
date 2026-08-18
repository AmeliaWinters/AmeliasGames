/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Absolute origin of the deployed game server, e.g.
   * https://amelias-games.you.workers.dev
   *
   * Required for the Android build, where the page is served from the app
   * itself and there is no server on `location.origin`. Left unset for the web
   * build, which is served by the same origin it talks to.
   */
  readonly VITE_SERVER_ORIGIN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
