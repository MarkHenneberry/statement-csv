"use client";

import { useId, useRef, useState, DragEvent, ChangeEvent } from "react";
import {
  estimatePageCount,
  formatBytes,
  validateFile,
  MAX_FILE_SIZE_MB,
} from "@/lib/upload";

export function UploadDropzone({
  file,
  onSelect,
  onReject,
}: {
  file: File | null;
  onSelect: (file: File) => void;
  onReject: (reason: string) => void;
}) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  function handleFiles(files: FileList | null) {
    const picked = files?.[0];
    if (!picked) return;
    const result = validateFile(picked);
    if (result.ok) {
      onSelect(picked);
    } else {
      onReject(result.reason);
    }
  }

  function onInputChange(e: ChangeEvent<HTMLInputElement>) {
    handleFiles(e.target.files);
    // Allow re-selecting the same file after a removal.
    e.target.value = "";
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    handleFiles(e.dataTransfer.files);
  }

  function openPicker() {
    inputRef.current?.click();
  }

  return (
    <div>
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept="application/pdf,.pdf"
        className="sr-only"
        onChange={onInputChange}
      />
      <div
        role="button"
        tabIndex={0}
        aria-label="Upload a PDF bank statement"
        onClick={openPicker}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openPicker();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-12 text-center transition ${
          dragging
            ? "border-brand-500 bg-brand-50"
            : "border-slate-300 bg-slate-50 hover:border-slate-400"
        }`}
      >
        {file ? (
          <div className="w-full">
            <div className="mx-auto flex max-w-sm items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 text-left">
              <span className="flex h-10 w-10 flex-none items-center justify-center rounded-lg bg-brand-50 text-brand-700">
                <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path d="M4 3a2 2 0 0 1 2-2h5.586a1 1 0 0 1 .707.293l3.414 3.414a1 1 0 0 1 .293.707V17a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V3Z" />
                </svg>
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-900">{file.name}</p>
                <p className="text-xs text-slate-500">
                  {formatBytes(file.size)} &middot; ~{estimatePageCount(file.size)} pages
                  (estimated)
                </p>
              </div>
            </div>
            <p className="mt-4 text-sm font-medium text-brand-700">
              Choose a different file
            </p>
          </div>
        ) : (
          <>
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-slate-400 shadow-sm">
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
              </svg>
            </span>
            <p className="mt-4 text-base font-semibold text-slate-900">
              Drag and drop your PDF here
            </p>
            <p className="mt-1 text-sm text-slate-500">or click to browse your files</p>
            <p className="mt-4 text-xs text-slate-400">
              PDF only &middot; up to {MAX_FILE_SIZE_MB} MB
            </p>
          </>
        )}
      </div>
    </div>
  );
}
