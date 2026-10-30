import { createHostClients } from "./host-clients";
import { openHost } from "./open-host";
import { designPreview, previewClient } from "../preview/preview-session";

/** The app's one client per saved computer (see createHostClients). */
export const hostClients = createHostClients(host => designPreview ? Promise.resolve(previewClient(host.serverId)) : openHost(host));
