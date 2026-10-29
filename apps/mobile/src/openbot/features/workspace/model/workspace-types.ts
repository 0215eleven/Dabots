// DS Bot Mobile adapter for UI code derived from OpenBot (PolyForm Noncommercial 1.0.0, see ../LICENSE).
import type { Bot } from "../../../../types";

/** A chat participant. `bot` is the DS Bot record the avatar and colours come from. */
export interface MobileAgent {
  id: string;
  serverId: string;
  name: string;
  title: string;
  description: string;
  preview: string;
  updatedLabel: string;
  avatarUrl?: string | null;
  avatarSeed: string;
  avatarHue: null;
  model?: string;
  bot?: Bot;
}
