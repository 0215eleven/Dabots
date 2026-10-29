import type { TranslatedLocale } from "./locale";
import type { PartialTranslation } from "./message";
import { source as en } from "./messages/en/source";
import { source as zh } from "./messages/zh/source";

// DS Bot Mobile ships English and Chinese; every other language falls back to English.
const catalogs: Partial<Record<TranslatedLocale, PartialTranslation<typeof en>>> = { en, zh };

/** The source catalog of `locale`, or `undefined` while it is not loaded. */
export function sourceTranslation(locale: TranslatedLocale): PartialTranslation<typeof en> | undefined {
  return catalogs[locale];
}
