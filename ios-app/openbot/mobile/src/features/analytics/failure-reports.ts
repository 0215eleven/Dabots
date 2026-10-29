// DS adaptation: reporting is disabled; local alerts and safe copyable references remain.
import type { FailureProperties, ReportQueue } from "@openbot/telemetry";
import { errorReference } from "@openbot/user-errors/reference";
import { Alert, type AlertButton } from "react-native";
import { currentText } from "@/shared/lib/text";

export function mobileReportQueue(): ReportQueue | undefined {
  return undefined;
}

export function reportMobileNotification(
  _error: unknown,
  _operation: FailureProperties["operation"],
  _presentation: "alert" | "banner" = "banner",
  _context: Partial<Pick<FailureProperties, "source" | "severity" | "provider" | "model">> = {},
): void {
  // Intentionally no storage, native application metadata, analytics or network work.
}

/**
 * Classify the original failure before the native alert receives its display text. When the failure
 * has a code, the alert shows the code under the message and adds a button that copies it.
 */
export function showFailureAlert(
  error: unknown,
  operation: FailureProperties["operation"],
  ...args: Parameters<typeof Alert.alert>
): void {
  reportMobileNotification(error, operation, "alert");
  const reference = errorReference(error);
  if (!reference) {
    Alert.alert(...args);
    return;
  }
  const [title, message, buttons, options] = args;
  const { t } = currentText();
  const code = t("error.reference.label", { code: reference });
  // An alert with a button list shows only those buttons, so a plain alert keeps a close button.
  const kept: AlertButton[] = buttons?.length ? buttons : [{ text: t("common.close"), style: "cancel" }];
  // Android shows at most three buttons. The code stays in the message when no button is free.
  const copy: AlertButton[] =
    kept.length < 3
      ? [
          {
            text: t("error.reference.copy"),
            // The code is also in the message, so a failed copy needs no second alert.
            onPress: () =>
              void import("expo-clipboard").then((clipboard) => clipboard.setStringAsync(reference)).catch(() => false),
          },
        ]
      : [];
  Alert.alert(title, message ? `${message}\n\n${code}` : code, [...kept, ...copy], options);
}

export function showWarningAlert(
  operation: FailureProperties["operation"],
  ...args: Parameters<typeof Alert.alert>
): void {
  reportMobileNotification(undefined, operation, "alert", { severity: "warning", source: "system" });
  Alert.alert(...args);
}
