/// <reference types="vite/client" />

declare module '*.ndjson?raw' {
  const content: string;
  export default content;
}
