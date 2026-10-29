// DS Bot Mobile adapter for UI code derived from OpenBot (PolyForm Noncommercial 1.0.0, see ../LICENSE).
import { botColor } from "../../../../components/BotAvatar";

/** The accent colour of a Bot: the one its character uses in this app. */
export function getBloubAvatarColor(seed: string, _hue: unknown): string {
  return botColor({ id: seed, color: undefined });
}
