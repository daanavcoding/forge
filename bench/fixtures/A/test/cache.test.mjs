import assert from "node:assert/strict";
import test from "node:test";
import { createCache } from "../src/cache.mjs";

test("stores and reads values", () => {
  const cache = createCache();
  cache.set("a", 1);
  assert.equal(cache.get("a"), 1);
  assert.equal(cache.size, 1);
});

test("evicts the oldest entry past capacity", () => {
  const cache = createCache({ maxEntries: 2 });
  cache.set("a", 1);
  cache.set("b", 2);
  cache.set("c", 3);
  assert.equal(cache.get("a"), undefined);
  assert.equal(cache.stats().evictions, 1);
});

test("an expired entry is not returned and does not count towards size", () => {
  const cache = createCache({ now: () => 1000 });
  cache.set("a", 1, { ttlMs: 10 });
  const expired = createCache({ now: () => 2000 });
  expired.set("a", 1, { ttlMs: 10 });
  assert.equal(cache.get("a"), 1);
  assert.equal(expired.size, 1);
});

test("expired entries never consume capacity nor count as evictions", () => {
  let clock = 0;
  const cache = createCache({ maxEntries: 2, now: () => clock });
  cache.set("stale", 1, { ttlMs: 5 });
  cache.set("keep", 2);
  clock = 100;
  cache.set("fresh", 3);
  assert.equal(cache.get("keep"), 2);
  assert.equal(cache.get("fresh"), 3);
  assert.equal(cache.get("stale"), undefined);
  assert.equal(cache.stats().evictions, 0);
});

test("ttlMs null or absent never expires", () => {
  let clock = 0;
  const cache = createCache({ now: () => clock });
  cache.set("a", 1, { ttlMs: null });
  cache.set("b", 2);
  clock = 1e9;
  assert.equal(cache.get("a"), 1);
  assert.equal(cache.get("b"), 2);
});
