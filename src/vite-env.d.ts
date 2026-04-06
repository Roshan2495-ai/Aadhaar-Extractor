/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GOOGLE_SHEET: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
