import { test } from "node:test";
import assert from "node:assert/strict";
import { emptyStats, pageEvent, parseStats, recordStats, statsView } from "../src/shared/stats.ts";

const NOW = new Date("2026-11-26T12:00:00Z");

test("parseStats tolerates missing, malformed and inconsistent values", () => {
  assert.deepEqual(parseStats(undefined, NOW), emptyStats(NOW));
  assert.deepEqual(parseStats("junk", NOW), emptyStats(NOW));
  assert.deepEqual(parseStats({ pages: -3, sentPages: 1.5, since: "not a date" }, NOW), { pages: 0, sentPages: 0, since: NOW.toISOString() });
  // More sent pages than pages can't be right; cap it.
  assert.equal(parseStats({ pages: 2, sentPages: 9, since: NOW.toISOString() }, NOW).sentPages, 2);
  const ok = { pages: 10, sentPages: 3, since: "2026-11-20T00:00:00.000Z" };
  assert.deepEqual(parseStats(ok, NOW), ok);
});

test("pageEvent counts a page once and its cloud send once", () => {
  // First report from a document: a new page.
  let e = pageEvent(undefined, 0, false);
  assert.deepEqual([e.newPage, e.newSend], [true, false]);
  // A late login form on the same document gets checked and sent to the cloud.
  e = pageEvent(e.next, 0, true);
  assert.deepEqual([e.newPage, e.newSend], [false, true]);
  // A manual re-check that goes to the cloud again: no new page, no new send.
  e = pageEvent(e.next, 0, true);
  assert.deepEqual([e.newPage, e.newSend], [false, false]);
  // A re-check that stayed on device doesn't forget the earlier send.
  e = pageEvent(e.next, 0, false);
  assert.equal(e.next.sent, true);
  assert.equal(pageEvent(e.next, 0, true).newSend, false);
  // Navigating in the same tab: a new page, sent or not.
  const nav = pageEvent(e.next, 1, true);
  assert.deepEqual([nav.newPage, nav.newSend], [true, true]);
});

test("recordStats adds events and keeps the start date", () => {
  let s = emptyStats(NOW);
  s = recordStats(s, { newPage: true, newSend: false });
  s = recordStats(s, { newPage: true, newSend: true });
  s = recordStats(s, { newPage: false, newSend: false });
  assert.deepEqual(s, { pages: 2, sentPages: 1, since: NOW.toISOString() });
});

test("statsView words the counts", () => {
  const since = "2026-11-20T12:00:00.000Z";
  assert.equal(statsView(emptyStats(NOW)).headline, "No pages looked at yet");
  assert.deepEqual(statsView({ pages: 1, sentPages: 0, since }), {
    headline: "1 page looked at, and nothing left this device",
    detail: "Since Nov 20. No page needed the cloud model.",
  });
  assert.deepEqual(statsView({ pages: 1214, sentPages: 16, since }), {
    headline: "1,214 pages looked at; 1,198 never left this device",
    detail: "Since Nov 20. 16 pages were sent to the cloud as a summary with personal details removed.",
  });
  assert.match(statsView({ pages: 5, sentPages: 1, since }).detail, /1 page was sent/);
});
