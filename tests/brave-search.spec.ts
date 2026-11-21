import { expect, test } from "@playwright/test";
import { searchBusinessWeb } from "../src/lib/research/brave-search";

test("Brave adapter returns bounded evidence with source URLs", async () => {
  let requestUrl = "";
  let requestHeaders = new Headers();
  const evidence = await searchBusinessWeb("Example business website Nigeria", "test-search-key", "NG", async (input, init) => {
    requestUrl = String(input);
    requestHeaders = new Headers(init?.headers);
    return new Response(JSON.stringify({
      web: { results: [
        { title: "Example Company", url: "https://example.com", description: "Official business website", page_age: "2026-11-01" },
        { title: "Unsafe result", url: "javascript:alert(1)", description: "Must be ignored" },
      ] },
    }), { status: 200 });
  });
  expect(new URL(requestUrl).searchParams.get("country")).toBe("NG");
  expect(requestHeaders.get("X-Subscription-Token")).toBe("test-search-key");
  expect(evidence).toHaveLength(1);
  expect(evidence[0].url).toBe("https://example.com/");
  expect(evidence[0].excerpt).toBe("Official business website");
});

test("Brave adapter rejects provider errors rather than inventing evidence", async () => {
  await expect(searchBusinessWeb("Example company", "test-key", undefined, async () =>
    new Response("unavailable", { status: 503 }),
  )).rejects.toThrow("HTTP 503");
});

test("Brave adapter validates query length before making a request", async () => {
  await expect(searchBusinessWeb(" ", "test-key", undefined, async () => {
    throw new Error("fetch must not be called");
  })).rejects.toThrow("1–600 characters");
});
