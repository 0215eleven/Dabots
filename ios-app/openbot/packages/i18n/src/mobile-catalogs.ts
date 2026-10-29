// DS mobile adaptation: full upstream language sources remain in the vendored archive.
import type { TranslatedLocale } from "./locale";
import type { PartialTranslation } from "./message";
import { type AppMobileMessages, enMobile } from "./messages/en/mobile";
import { zhMobile } from "./messages/zh/mobile";

/** Missing translations use English source text and its plural rules. */
export function mobileCatalog(locale: TranslatedLocale): PartialTranslation<AppMobileMessages> | undefined {
  return locale === "zh" ? zhMobile : locale === "en" ? enMobile : undefined;
}
