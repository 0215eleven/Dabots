import { officialRelay } from "../logic/hosts";
import { useSession } from "./SessionProvider";

/** The relay this phone can administer: the official one, else the relay of a paired computer. */
export function useAdminRelay(): string | null {
  const { hosts } = useSession();
  return officialRelay() ?? hosts.find(host => host.relay)?.relay?.relay ?? null;
}
