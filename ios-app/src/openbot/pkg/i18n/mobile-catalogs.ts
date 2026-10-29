import type { TranslatedLocale } from "./locale";
import type { PartialTranslation } from "./message";
import { type AppMobileMessages, enMobile } from "./messages/en/mobile";
import { zhMobile } from "./messages/zh/mobile";

// DS Bot Mobile ships English and Chinese; every other language falls back to English.
export function mobileCatalog(locale: TranslatedLocale): PartialTranslation<AppMobileMessages> {
  return locale === "zh" ? zhMobile : enMobile;
}
