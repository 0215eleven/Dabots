// DS Bot Mobile adapter for UI code derived from OpenBot (PolyForm Noncommercial 1.0.0, see ../LICENSE).
import type { MobileServer } from "../context/mobile-workspace-context";

export function showsOnline(server: MobileServer | undefined): boolean {
  return server?.online ?? false;
}
