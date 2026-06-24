import { ReactNode } from "react";

export function Container({
  children,
  className = "",
  size = "default",
}: {
  children: ReactNode;
  className?: string;
  /** Widen the container for the conversion/review flow. */
  size?: "default" | "wide" | "review";
}) {
  const maxWidth =
    size === "review" ? "max-w-review" : size === "wide" ? "max-w-wide" : "max-w-content";
  return (
    <div className={`mx-auto w-full ${maxWidth} px-4 sm:px-6 lg:px-8 ${className}`}>
      {children}
    </div>
  );
}
