// Scanning a waiting computer's code with the relay admin's phone approves it on the relay.
import { type AdminKey, createRelayAdmin, RelayAdminError } from "./relay-admin.ts";

export class ComputerNotApprovedError extends Error {}

/** Approves the computer when this phone is the relay's admin; otherwise says who must approve it. */
export async function approveWaitingComputer(relay: string, computerId: string, { key, fetch = globalThis.fetch }: { key: () => Promise<AdminKey>; fetch?: typeof globalThis.fetch }): Promise<void> {
  const admin = createRelayAdmin({ relay, key: await key(), fetch });
  let status: { admin: boolean };
  try { status = await admin.status(); }
  catch (problem) { if (problem instanceof RelayAdminError) throw new ComputerNotApprovedError("This computer is waiting for the relay admin. Scan its code with the admin's phone first."); throw problem; }
  if (!status.admin) throw new ComputerNotApprovedError("This computer is waiting for the relay admin. Scan its code with the admin's phone first.");
  await admin.approve(computerId);
}
