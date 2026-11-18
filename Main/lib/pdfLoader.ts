import type { PDFDocument } from "../types";

interface PdfJsModule {
    GlobalWorkerOptions: { workerSrc: string };
    getDocument(params: { data: ArrayBuffer }): { promise: Promise<PDFDocument> };
}

let pdfjsModule: PdfJsModule | null = null;

export async function loadPdfJs(): Promise<PdfJsModule> {
    if (pdfjsModule) return pdfjsModule;

    const pdfjs = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/build/pdf.worker.min.mjs",
        import.meta.url
    ).toString();
    pdfjsModule = pdfjs as unknown as PdfJsModule;
    return pdfjsModule;
}

export async function openPdfDocument(data: ArrayBuffer): Promise<PDFDocument> {
    const pdfjs = await loadPdfJs();
    return pdfjs.getDocument({ data: data.slice(0) }).promise;
}
