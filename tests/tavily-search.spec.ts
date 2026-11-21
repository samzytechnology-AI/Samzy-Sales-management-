import { expect, test } from "@playwright/test";
import { searchBusinessWeb } from "../src/lib/research/tavily-search";

test("Tavily adapter sends bounded query and returns safe source evidence", async () => {
  let sent: Record<string, unknown> = {};
  const evidence = await searchBusinessWeb("school website Nigeria", "test-tavily-key", "NG", async (_input, init) => {
    sent = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({
      results: [
        { title: "Example School", url: "https://example.edu.ng", content: "Official school information", published_date: "2026-11-20" },
        { title: "Unsafe", url: "javascript:alert(1)", content: "Ignore" },
      ],
    }), { status: 200 });
  });
  expect(sent.search_depth).toBe("basic");
  expect(sent.max_results).toBe(8);
  expect(sent.query).toContain("NG");
  expect(evidence).toHaveLength(1);
  expect(evidence[0].url).toBe("https://example.edu.ng/");
  expect(evidence[0].excerpt).toBe("Official school information");
});

test("Tavily adapter fails closed on provider errors", async () => {
  await expect(searchBusinessWeb("Example business", "test-key", undefined, async () =>
    new Response("unavailable", { status: 503 }),
  )).rejects.toThrow("HTTP 503");
});

test("Tavily adapter rejects empty queries before network access", async () => {
  await expect(searchBusinessWeb(" ", "test-key", undefined, async () => {
    throw new Error("fetch must not be called");
  })).rejects.toThrow("1–600 characters");
});
