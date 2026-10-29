// DS mobile adaptation: retain upstream catalogs on disk; ship only English and Chinese.
import type { TranslatedLocale } from "./locale";
import type { PartialTranslation } from "./message";
import { source as en } from "./messages/en/source";
import { source as zh } from "./messages/zh/source";

/** Missing translations use English source text and its plural rules. */
export function sourceTranslation(locale: TranslatedLocale): PartialTranslation<typeof en> | undefined {
  return locale === "zh" ? zh : locale === "en" ? en : undefined;
}
