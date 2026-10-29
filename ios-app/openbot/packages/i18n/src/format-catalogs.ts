// DS mobile adaptation: retain upstream catalogs on disk; ship only English and Chinese.
import type { TranslatedLocale } from "./locale";
import type { PartialTranslation } from "./message";
import { messages as en } from "./messages/en/format";
import { messages as zh } from "./messages/zh/format";

/** Missing translations use English source text and its plural rules. */
export function formatTranslation(locale: TranslatedLocale): PartialTranslation<typeof en> | undefined {
  return locale === "zh" ? zh : locale === "en" ? en : undefined;
}
