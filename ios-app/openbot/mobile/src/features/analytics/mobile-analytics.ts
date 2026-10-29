import { ANALYTICS_GENERATIONS } from "@openbot/telemetry";
import { OpenPanel, type TrackHandlerPayload } from "@openpanel/react-native";
import * as Application from "expo-application";
import { Platform } from "react-native";
import { MobileAnalytics } from "./analytics-core";
import { MOBILE_EVENTS, type MobileEventName, sanitizeMobileEvent } from "./events";
import { mobileReportQueue } from "./failure-reports";

const metadata = {
  surface: "mobile",
  environment: "production",
  event_schema_version: ANALYTICS_GENERATIONS.mobile,
  platform: Platform.OS,
  app_version: Application.nativeApplicationVersion ?? "unknown",
  build_number: Application.nativeBuildVersion ?? "unknown",
};

// RN's SDK adds Android install referrers and paths itself. Replace its final
// properties so those additions cannot expose campaign URLs or route identifiers.
function filterMobilePayload(event: TrackHandlerPayload): boolean {
  if (!mobileAnalytics.isEnabled()) return false;
  if (event.type === "identify") {
    event.payload = { profileId: event.payload.profileId, email: event.payload.email, properties: metadata };
    return true;
  }
  if (event.type !== "track") return false;
  const name = Object.keys(MOBILE_EVENTS).find(
    (candidate): candidate is MobileEventName => candidate === event.payload.name,
  );
  if (!name) return false;
  const timestamp = event.payload.properties?.__timestamp;
  event.payload.properties = {
    ...sanitizeMobileEvent(name, event.payload.properties ?? {}),
    ...metadata,
    ...(typeof timestamp === "string" && Number.isFinite(Date.parse(timestamp))
      ? { __timestamp: new Date(timestamp).toISOString() }
      : {}),
    __referrer: "",
    __path: "",
  };
  return true;
}

export const mobileAnalytics = new MobileAnalytics(() => null);
