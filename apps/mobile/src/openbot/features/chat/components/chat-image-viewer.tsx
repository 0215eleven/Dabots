// DS Bot Mobile adapter for UI code derived from OpenBot (PolyForm Noncommercial 1.0.0, see ../LICENSE).
import type { PropsWithChildren } from "react";

export function ChatImageViewerProvider({ children }: PropsWithChildren<any>) {
  return children;
}
export function isViewableImage(_attachment: unknown): boolean {
  return false;
}
