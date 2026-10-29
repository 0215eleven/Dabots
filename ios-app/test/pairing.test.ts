import test from "node:test";
import assert from "node:assert/strict";
import { parsePairing, PairingFormatError } from "../src/logic/pairing.ts";
import { hostAddress } from "../src/logic/hosts.ts";

const relay = { v: 2, relay: "wss://relay.example.com/", computerId: "A".repeat(22), computerKey: "B".repeat(43), serverId: "server", code: "code", expiresAt: 1 };

test("relay codes carry the relay and the computer identity, never an address", () => {
  assert.deepEqual(parsePairing(JSON.stringify(relay)), { kind: "relay", relay: "wss://relay.example.com", computerId: "A".repeat(22), computerKey: "B".repeat(43), code: "code", serverId: "server" });
  for (const bad of [{ relay: "https://relay.example.com" }, { relay: "wss://user@relay.example.com" }, { relay: "wss://relay.example.com/path" }, { computerKey: "short" }, { computerId: "x" }])
    assert.throws(() => parsePairing(JSON.stringify({ ...relay, ...bad })), PairingFormatError);
});

test("direct codes keep their address and optional pin", () => {
  assert.deepEqual(parsePairing('{"url":"https://host.example","code":"c","serverId":"s"}'), { kind: "direct", url: "https://host.example", code: "c", serverId: "s" });
  assert.throws(() => parsePairing("{not json"), /not valid pairing JSON/);
  assert.throws(() => parsePairing('{"url":"https://host.example","serverId":"s"}'), /complete pairing JSON/);
});

test("a relay computer is shown by its relay host", () => {
  assert.equal(hostAddress({ url: "https://abc.relay.invalid", relay: { relay: "wss://relay.example.com", computerId: "A".repeat(22), computerKey: "B".repeat(43) } }), "relay.example.com");
});
