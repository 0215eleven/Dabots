// DS Bot Mobile adapter for UI code derived from OpenBot (PolyForm Noncommercial 1.0.0, see ../LICENSE).
import type { TranslatedLocale } from "@openbot/i18n/mobile";

export interface UserErrorDetails {
  message: string;
  reference?: string;
}

/** The error's own message when it has a readable one, else the translated fallback. */
export function userErrorMessage(error: unknown, fallback: string, _locale: TranslatedLocale = "en"): string {
  const message = error instanceof Error ? error.message.trim() : "";
  return message && message.length <= 200 ? message : fallback;
}

export function userErrorDetails(error: unknown, fallback: string, locale: TranslatedLocale = "en"): UserErrorDetails {
  return { message: userErrorMessage(error, fallback, locale) };
}
