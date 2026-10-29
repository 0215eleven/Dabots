// DS Bot Mobile adapter for UI code derived from OpenBot (PolyForm Noncommercial 1.0.0, see ../LICENSE).
import { Alert } from "react-native";

/** Shows a failure to the person. DS Bot Mobile sends no failure reports. */
export function showFailureAlert(_error: unknown, _area: string, title: string, message: string) {
  Alert.alert(title, message);
}
