import type { TranslatedLocale } from "./locale";
import type { PartialTranslation } from "./message";
import { type AppMessages, en } from "./messages/en/index";
import { zh } from "./messages/zh/index";

/**
 * The desktop catalog of `locale`, or `undefined` while it is not loaded.
 *
 * The DS mobile installation ships English and Chinese, including consumers of
 * this shared root entry. Other locales use translateFor's English source fallback.
 */
export function appTranslation(locale: TranslatedLocale): PartialTranslation<AppMessages> | undefined {
  return locale === "zh" ? zh : locale === "en" ? en : undefined;
}
