/**
 * pdfjs-dist publica tipos para `legacy/build/pdf.mjs` (pdf.d.mts irmão),
 * mas NÃO para o worker (`pdf.worker.mjs`). O módulo resolve em runtime
 * (import dinâmico pelo specifier de pacote) e exporta apenas
 * `WorkerMessageHandler` — usado pelo pdf-text.ts para registrar o fake
 * worker na main thread (evita o import relativo que quebra no deploy).
 */
declare module "pdfjs-dist/legacy/build/pdf.worker.mjs" {
  export const WorkerMessageHandler: unknown;
}
