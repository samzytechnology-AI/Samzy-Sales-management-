import { expect, test } from "@playwright/test";
import { evaluateOutreach } from "../src/lib/outreach/policy";

const base = {
  normalizedAddress: "owner@example.com",
  optedOut: false,
  contactCount30d: 0,
  totalOutboundCount: 0,
  activeConversation: false,
};

test("allows the researched first contact when no prior outreach exists", () => {
  expect(evaluateOutreach(base, "email", new Date("2026-11-21T12:00:00.000Z")).allowed).toBe(true);
});

test("requires five business days before the first follow-up", () => {
  const state = { ...base, totalOutboundCount: 1, contactCount30d: 1, lastContactAt: "2026-11-16T12:00:00.000Z" };
  const before = evaluateOutreach(state, "email", new Date("2026-11-20T12:00:00.000Z"));
  const ready = evaluateOutreach(state, "email", new Date("2026-11-23T12:00:00.000Z"));
  expect(before.allowed).toBe(false);
  expect(before.reason).toContain("five business days");
  expect(ready.allowed).toBe(true);
});

test("requires seven additional business days before the final follow-up", () => {
  const state = { ...base, totalOutboundCount: 2, contactCount30d: 2, lastContactAt: "2026-11-16T12:00:00.000Z" };
  const before = evaluateOutreach(state, "email", new Date("2026-11-24T12:00:00.000Z"));
  const ready = evaluateOutreach(state, "email", new Date("2026-11-25T12:00:00.000Z"));
  expect(before.allowed).toBe(false);
  expect(before.reason).toContain("seven business days");
  expect(ready.allowed).toBe(true);
});

test("stops after the initial message and two follow-ups even after 30 days", () => {
  const state = { ...base, totalOutboundCount: 3, contactCount30d: 0 };
  const result = evaluateOutreach(state, "email", new Date("2027-02-01T12:00:00.000Z"));
  expect(result.allowed).toBe(false);
  expect(result.reason).toContain("three-message sequence is complete");
});

test("suppression and active conversations always stop new outreach", () => {
  expect(evaluateOutreach({ ...base, optedOut: true }, "email").allowed).toBe(false);
  expect(evaluateOutreach({ ...base, activeConversation: true }, "email").allowed).toBe(false);
});
