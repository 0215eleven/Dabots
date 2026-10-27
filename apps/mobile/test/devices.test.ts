import test from "node:test";
import assert from "node:assert/strict";
import { groupDevices, isStale, relativeDay, STALE_AFTER } from "../src/logic/devices.ts";

const now = new Date(2026, 9, 23, 15).getTime();
const day = 86_400_000;

test("this phone is set apart and the rest are ordered by most recent use", () => {
  const devices = [
    { id: "old", name: "My iPhone", createdAt: now - 90 * day, lastSeenAt: now - 60 * day },
    { id: "me", name: "My iPhone", createdAt: now - 2 * day, lastSeenAt: now },
    { id: "gone", name: "iPad", revokedAt: now - day },
    { id: "ipad", name: "iPad", createdAt: now - 10 * day, lastSeenAt: now - day },
    { id: "never", name: "Pending" },
  ];
  const { current, others } = groupDevices(devices, "me");
  assert.equal(current?.id, "me");
  assert.deepEqual(others.map(device => device.id), ["ipad", "old", "never"]);
  assert.equal(groupDevices(devices, "").current, null);
  assert.equal(groupDevices(devices, "").others.length, 4);
});

test("a device unused past its session lifetime reads as signed out", () => {
  assert.equal(isStale({ id: "a", lastSeenAt: now - STALE_AFTER - 1 }, now), true);
  assert.equal(isStale({ id: "a", lastSeenAt: now - day }, now), false);
  assert.equal(isStale({ id: "a", createdAt: now - STALE_AFTER - day }, now), true);
  assert.equal(isStale({ id: "a" }, now), false);
});

test("pairing and activity times are calendar days, not raw timestamps", () => {
  assert.deepEqual(relativeDay(now - 60_000, now), ["today"]);
  assert.deepEqual(relativeDay(new Date(2026, 9, 22, 23, 50).getTime(), now), ["yesterday"]);
  assert.deepEqual(relativeDay(now - 5 * day, now), ["{count} days ago", { count: 5 }]);
  assert.deepEqual(relativeDay(new Date(2026, 0, 3).getTime(), now), ["{year}-{month}-{day}", { year: 2026, month: 1, day: 3 }]);
  assert.equal(relativeDay(undefined, now), null);
  assert.equal(relativeDay("2026-01-01", now), null);
});
