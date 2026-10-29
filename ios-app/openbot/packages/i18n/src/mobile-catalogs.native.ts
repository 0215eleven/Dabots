// DS mobile adaptation: only shipped languages have literal Metro dependencies.
import type { TranslatedLocale } from "./locale";
import type { PartialTranslation } from "./message";
import { type AppMobileMessages, enMobile } from "./messages/en/mobile";

/** Chinese initializes on use; unsupported languages use the English source fallback. */
export function mobileCatalog(locale: TranslatedLocale): PartialTranslation<AppMobileMessages> | undefined {
  if (locale === "en") return enMobile;
  if (locale === "zh") {
    const catalog: typeof import("./messages/zh/mobile") = require("./messages/zh/mobile");
    return catalog.zhMobile;
  }
  return undefined;
}
