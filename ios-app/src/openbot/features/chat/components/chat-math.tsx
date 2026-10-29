// DS Bot Mobile adapter for UI code derived from OpenBot (PolyForm Noncommercial 1.0.0, see ../LICENSE).
import type { ReactNode } from "react";

/** DS Bot Mobile does not render TeX; the source shows as code through `fallback`. */
export function ChatMath({ fallback }: { fallback?: ReactNode; [key: string]: unknown }) {
  return fallback ?? null;
}
