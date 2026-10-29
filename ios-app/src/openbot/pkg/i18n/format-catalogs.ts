import type { TranslatedLocale } from "./locale";
import type { PartialTranslation } from "./message";
import { messages as en } from "./messages/en/format";
import { messages as zh } from "./messages/zh/format";

// DS Bot Mobile ships English and Chinese; every other language falls back to English.
const catalogs: Partial<Record<TranslatedLocale, PartialTranslation<typeof en>>> = { en, zh };

/** The format catalog of `locale`, or `undefined` while it is not loaded. */
export function formatTranslation(locale: TranslatedLocale): PartialTranslation<typeof en> | undefined {
  return catalogs[locale];
}
