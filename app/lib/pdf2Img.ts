// Import PDF.js types
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";

export interface PdfConversionResult {
  imageUrl: string;
  file: File | null;
  error?: string;
}

let pdfjsLib: any = null;
let isLoading = false;
let loadPromise: Promise<any> | null = null;

async function loadPdfJs(): Promise<any> {
  if (pdfjsLib) return pdfjsLib;
  if (loadPromise) return loadPromise;

  isLoading = true;
  // @ts-expect-error - pdfjs-dist/build/pdf.mjs is not a module
  loadPromise = import("pdfjs-dist/build/pdf.mjs").then((lib) => {
    // Set the worker source to use local file
    const workerSrc = new URL(
      'pdfjs-dist/build/pdf.worker.min.mjs',
      import.meta.url
    ).toString();
    lib.GlobalWorkerOptions.workerSrc = workerSrc;
    pdfjsLib = lib;
    isLoading = false;
    return lib;
  });

  return loadPromise;
}

// Helper function to add timeout to promises
const withTimeout = <T>(promise: Promise<T>, timeoutMs: number, errorMsg: string): Promise<T> => {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(errorMsg));
    }, timeoutMs);
    
    promise.then(
      (result) => {
        clearTimeout(timeoutId);
        resolve(result);
      },
      (error) => {
        clearTimeout(timeoutId);
        reject(error);
      }
    );
  });
};

export async function convertPdfToImage(
  file: File,
): Promise<PdfConversionResult> {
  try {
    const lib = await withTimeout(loadPdfJs(), 10000, "PDF.js library loading timed out");

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await withTimeout(
      lib.getDocument({ data: arrayBuffer }).promise,
      15000,
      "PDF document loading timed out"
    ) as PDFDocumentProxy;
    const page = await withTimeout(
      pdf.getPage(1),
      5000,
      "PDF page loading timed out"
    ) as PDFPageProxy;

    const viewport = page.getViewport({ scale: 4 });
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { willReadFrequently: true });
    
    if (!context) {
      throw new Error("Could not get canvas context");
    }

    canvas.width = viewport.width;
    canvas.height = viewport.height;

    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";

    try {
      await withTimeout(
        page.render({ canvasContext: context, canvas, viewport }).promise,
        20000,
        "PDF rendering timed out"
      );
    } catch (renderError) {
      console.error("PDF render error:", renderError);
      
      // Fallback to a simpler rendering approach
      const fallbackViewport = page.getViewport({ scale: 2 }); // Lower scale as fallback
      canvas.width = fallbackViewport.width;
      canvas.height = fallbackViewport.height;
      
      await withTimeout(
        page.render({ canvasContext: context, canvas, viewport: fallbackViewport }).promise,
        15000,
        "PDF fallback rendering timed out"
      );
    }

    return new Promise((resolve) => {
      canvas.toBlob(
        (blob) => {
          if (blob) {
            // Create a File from the blob with the same name as the pdf
            const originalName = file.name.replace(/\.pdf$/i, "");
            const imageFile = new File([blob], `${originalName}.png`, {
              type: "image/png",
            });

            resolve({
              imageUrl: URL.createObjectURL(blob),
              file: imageFile,
            });
          } else {
            resolve({
              imageUrl: "",
              file: null,
              error: "Failed to create image blob",
            });
          }
        },
        "image/png",
        1.0,
      ); // Set quality to maximum (1.0)
    });
  } catch (err) {
    console.error("PDF conversion error:", err);
    return {
      imageUrl: "",
      file: null,
      error: `Failed to convert PDF: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
