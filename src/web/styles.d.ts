declare module "*.css";

interface ImportMetaEnv {
  readonly VITE_ORGANIZATION_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
