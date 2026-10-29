// DS Bot Mobile glue (PolyForm Noncommercial 1.0.0 derived UI, see ./LICENSE): the OpenBot components read
// their language from a store; this app's own language preference decides it.
import { useEffect } from "react";
import { useI18n } from "../i18n";
import { useAppLanguage } from "@/features/settings/model/app-language";

export function LocaleBridge() {
  const { locale } = useI18n();
  useEffect(() => {
    useAppLanguage.setState({ value: locale === "zh" ? "zh" : "en", ready: true });
  }, [locale]);
  return null;
}
