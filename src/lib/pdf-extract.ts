// Server-only entry point for PDF text extraction. The implementation lives in
// pdf-extract-core.ts; this module adds the "server-only" guard so the extractor
// can never be bundled into a client component.
//
// TODO(launch-blocker): verify in the deployment target that uploaded bytes are
// only held in memory for the duration of the request and never written to disk
// or a temp file by the runtime. Deletion-after-conversion must be confirmed
// before launch.

import "server-only";

export { extractPdfText, type ExtractedPdf } from "@/lib/pdf-extract-core";
