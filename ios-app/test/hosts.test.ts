import test from "node:test";
import assert from "node:assert/strict";
import { activeHost, hostAddress, OFFICIAL_CONNECTION, OFFICIAL_RELAY, removeHost, restoreHosts, upsertHost } from "../src/logic/hosts.ts";

const legacy = { url: "https://home.example:7443", serverId: "srv-home", name: "Home" };
const office = { url: "https://office.example", serverId: "srv-office", name: "Office", slot: "a" };

test("the host paired before multi-host support joins the list once", () => {
  assert.deepEqual(restoreHosts(null, legacy), [legacy]);
  assert.deepEqual(restoreHosts([office], legacy), [legacy, office]);
  assert.deepEqual(restoreHosts([legacy, office], legacy), [legacy, office]);
  assert.deepEqual(restoreHosts([office, { ...office, name: "Copy" }, "junk", { slot: "x" }], null), [office]);
});

test("re-pairing a computer replaces it in place and reports superseded credentials", () => {
  const repaired = { ...legacy, slot: "b", name: "Home PC" };
  const { hosts, replaced } = upsertHost([legacy, office], repaired);
  assert.deepEqual(hosts, [repaired, office]);
  assert.deepEqual(replaced, [legacy]);
  const added = upsertHost([legacy], office);
  assert.deepEqual(added.hosts, [legacy, office]);
  assert.deepEqual(added.replaced, []);
  assert.deepEqual(upsertHost([office], { ...office, name: "Renamed" }).replaced, []);
});

test("removing and choosing the active computer", () => {
  assert.deepEqual(removeHost([legacy, office], legacy), [office]);
  assert.deepEqual(removeHost([legacy, office], office), [legacy]);
  assert.equal(activeHost([legacy, office], "a"), office);
  assert.equal(activeHost([legacy, office], ""), legacy);
  assert.equal(activeHost([legacy, office], "gone"), legacy);
  assert.equal(activeHost([], "a"), null);
});

test("computer addresses are short and tolerate malformed URLs", () => {
  assert.equal(hostAddress(legacy), "home.example:7443");
  assert.equal(hostAddress({ url: "https://h.example/dsh/" }), "h.example/dsh");
  assert.equal(hostAddress({ url: "not a url" }), "not a url");
});

test("the official relay is shown as the official connection, never its domain", () => {
  const relay = (origin: string) => ({ url: "https://unused.example", relay: { relay: origin, computerId: "c", computerKey: "k" } });
  assert.equal(hostAddress(relay(OFFICIAL_RELAY)), OFFICIAL_CONNECTION);
  assert.equal(hostAddress(relay(`${OFFICIAL_RELAY}/`)), OFFICIAL_CONNECTION);
  assert.equal(hostAddress(relay("wss://relay.example.com")), "relay.example.com", "an owner's own relay keeps its address");
});
