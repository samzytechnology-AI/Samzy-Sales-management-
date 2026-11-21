import { expect, test } from "@playwright/test";


async function connectMockWorkspace(page: import("@playwright/test").Page) {
  const user = {
    id: "55555555-5555-4555-8555-555555555555",
    aud: "authenticated",
    role: "authenticated",
    email: "admin@samzy.test",
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: {},
    created_at: "2026-01-01T00:00:00.000Z",
  };
  const accessToken = "eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiI1NTU1NTU1NS01NTU1LTQ1NTUtODU1NS01NTU1NTU1NTU1NTUiLCJhdWQiOiJhdXRoZW50aWNhdGVkIiwiZXhwIjo5OTk5OTk5OTk5LCJyb2xlIjoiYXV0aGVudGljYXRlZCJ9.signature";
  const session = { access_token: accessToken, token_type: "bearer", expires_in: 3600, refresh_token: "mock-refresh-token", user };
  const records: Record<string, any[]> = { prospects: [], clients: [], projects: [], products: [], approvals: [], finance: [], outreach: [] };

  await page.route("**/auth/v1/token?grant_type=password", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(session) }));
  await page.route("**/api/ai/run", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ conversationId: null, messages: [] }) }));
  await page.route("**/api/workspace**", async route => {
    const request = route.request();
    console.log("WORKSPACE MOCK", request.method(), request.url());
    if (request.method() === "GET") {
      const summary = { prospects: records.prospects.length, clients: records.clients.length, activeProjects: records.projects.length, pendingApprovals: records.approvals.filter(x => x.status === "pending").length, incomeNgn: 0, expensesNgn: 0, netNgn: 0 };
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ summary, ...Object.fromEntries(Object.entries(records).map(([key, value]) => [key, value])) }) });
      return;
    }
    if (request.method() === "POST") {
      const input = request.postDataJSON() as Record<string, any>;
      const map: Record<string, string> = { client: "clients", project: "projects", prospect: "prospects", finance: "finance", approval: "approvals", product: "products" };
      const key = map[input.type];
      console.log("WORKSPACE CREATE", input.type, key, input);
      if (!key) {
        await route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: "Unknown mock record type" }) });
        return;
      }
      const record = { ...input, id: `mock-${records[key].length + 1}`, status: input.type === "approval" ? "pending" : input.status ?? "active" };
      records[key].unshift(record);
      await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ record }) });
      return;
    }
    if (request.method() === "PATCH") {
      const input = request.postDataJSON() as Record<string, any>;
      const item = records.approvals.find(x => x.id === input.id);
      if (item) item.status = input.decision;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ record: item ?? input }) });
      return;
    }
    await route.continue();
  });

  await page.goto("/");
  await page.getByRole("button", { name: /Talk to AI Manager/ }).click();
  await page.getByLabel("Company email").fill("admin@samzy.test");
  await page.getByLabel("Password").fill("mock-password");
  await page.getByLabel("Organisation UUID").fill("00000000-0000-4000-8000-000000000001");
  await page.getByRole("button", { name: "Connect workspace" }).click();
  await expect(page.locator(".auth-text")).toContainText("Secure session connected.");
  return records;
}

test("all primary navigation controls open their corresponding workspace views", async ({ page }) => {
  await page.goto("/");
  const sections = [
    "Overview",
    "AI General Manager",
    "Leads & CRM",
    "Clients",
    "Projects",
    "Product Registry",
    "Sales & Outreach",
    "Approvals",
    "Finance",
    "Settings",
  ];

  for (const section of sections) {
    await page.getByRole("button", { name: new RegExp(section) }).first().click();
    await expect(page.locator(".crumb")).toContainText(section);
    if (section !== "Overview" && section !== "AI General Manager") {
      await expect(page.getByRole("heading", { name: section })).toBeVisible();
      await expect(page.getByText("Connect your company workspace to view live records.")).toBeVisible();
    }
  }
});

test("dashboard call-to-action opens the AI General Manager", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Talk to AI Manager/ }).click();
  await expect(page.getByRole("heading", { name: "Talk to your AI General Manager" })).toBeVisible();
});

test("quick commands execute through the chat flow and do not pretend to run offline", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Research new prospects/ }).click();
  await expect(page.locator(".crumb")).toContainText("AI General Manager");
  await expect(page.locator(".messages")).toContainText("Research new Nigerian businesses");
  await expect(page.locator(".messages")).toContainText("secure company workspace is not connected");
});

test("suggested prompt buttons submit a chat prompt", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Talk to AI Manager/ }).click();
  await page.getByRole("button", { name: /Give me a complete briefing/ }).click();
  await expect(page.locator(".messages")).toContainText("Give me a complete briefing on the company.");
  await expect(page.locator(".messages")).toContainText("secure company workspace is not connected");
});

test("chat composer accepts text and reports the disconnected workspace honestly", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Talk to AI Manager/ }).click();
  await page.getByPlaceholder(/Ask your AI General Manager anything/).fill("Summarise today's company operations.");
  await page.getByRole("button", { name: /Send command/ }).click();
  await expect(page.locator(".messages")).toContainText("Summarise today's company operations.");
  await expect(page.locator(".messages")).toContainText("secure company workspace is not connected");
});

test("workspace sign-in reports invalid credentials from Supabase", async ({ page }) => {
  await page.route("**/auth/v1/token?grant_type=password", route => route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ code: "invalid_credentials", message: "Invalid login credentials" }) }));
  await page.goto("/");
  await page.getByRole("button", { name: /Talk to AI Manager/ }).click();
  await page.getByLabel("Company email").fill("admin@example.com");
  await page.getByLabel("Password").fill("not-a-real-password");
  await page.getByLabel("Organisation UUID").fill("00000000-0000-4000-8000-000000000001");
  await page.getByRole("button", { name: "Connect workspace" }).click();
  await expect(page.locator(".auth-text")).toContainText("Invalid login credentials");
});

test("overview intelligence link opens the AI Manager", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Open AI General Manager/ }).click();
  await expect(page.locator(".crumb")).toContainText("AI General Manager");
  await expect(page.getByRole("heading", { name: "Talk to your AI General Manager" })).toBeVisible();
});

test("module discussion action returns to the AI Manager", async ({ page }) => {
  await page.goto("/");
  await page.locator("nav").getByRole("button", { name: /Projects/ }).click();
  await page.getByRole("button", { name: /Discuss with AI Manager/ }).click();
  await expect(page.locator(".crumb")).toContainText("AI General Manager");
});

test("authenticated dashboard can create a client record", async ({ page }) => {
  const records = await connectMockWorkspace(page);
  await page.locator("nav").getByRole("button", { name: /Clients/ }).click();
  await page.getByPlaceholder("Company / client name").fill("Test Client Limited");
  await page.getByRole("button", { name: "Save client" }).click();
  await expect.poll(() => records.clients.length).toBe(1);
  await expect(page.getByText("Test Client Limited")).toBeVisible();
});

test("authenticated dashboard can register a product", async ({ page }) => {
  const records = await connectMockWorkspace(page);
  await page.locator("nav").getByRole("button", { name: /Product Registry/ }).click();
  await page.getByPlaceholder("Product name").fill("Samzy Test Studio");
  await page.getByPlaceholder("Unique key (lowercase, hyphens)").fill("samzy-test-studio");
  await page.getByRole("button", { name: "Register product" }).click();
  await expect.poll(() => records.products.length).toBe(1);
  await expect(page.getByText("Samzy Test Studio")).toBeVisible();
});

test("authenticated dashboard can record finance and display the saved transaction", async ({ page }) => {
  await connectMockWorkspace(page);
  await page.locator("nav").getByRole("button", { name: /Finance/ }).click();
  await page.getByPlaceholder("Category").fill("Web development");
  await page.getByPlaceholder("Description").fill("Website project deposit");
  await page.getByPlaceholder("Amount in NGN").fill("150000");
  await page.getByRole("button", { name: "Save transaction" }).click();
  await expect(page.getByText("Website project deposit")).toBeVisible();
});

test("authenticated dashboard can submit and decide an approval request", async ({ page }) => {
  const records = await connectMockWorkspace(page);
  await page.locator("nav").getByRole("button", { name: /Approvals/ }).click();
  await page.getByPlaceholder("Approval title").fill("Approve test outreach");
  await page.getByPlaceholder("What needs approval and why?").fill("Approve the reviewed sample outreach message.");
  await page.getByRole("button", { name: "Submit for approval" }).click();
  await expect.poll(() => records.approvals.length).toBe(1);
  await expect(page.getByText("Approve test outreach")).toBeVisible();
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.getByText("approved", { exact: true })).toBeVisible();
});


test("authenticated dashboard can add a prospect to CRM", async ({ page }) => {
  const records = await connectMockWorkspace(page);
  await page.locator("nav").getByRole("button", { name: /Leads & CRM/ }).click();
  await page.getByPlaceholder("Company name").fill("Prospect Test Company");
  await page.getByRole("button", { name: "Save prospect" }).click();
  await expect.poll(() => records.prospects.length).toBe(1);
  await expect(page.getByText("Prospect Test Company")).toBeVisible();
});

test("authenticated dashboard can create a project", async ({ page }) => {
  const records = await connectMockWorkspace(page);
  await page.locator("nav").getByRole("button", { name: /Projects/ }).click();
  await page.getByPlaceholder("Project name").fill("Test Website Project");
  await page.getByPlaceholder("Quoted amount (₦)").fill("200000");
  await page.getByRole("button", { name: "Create project" }).click();
  await expect.poll(() => records.projects.length).toBe(1);
  await expect(page.getByText("Test Website Project")).toBeVisible();
});

test("authenticated company user can sign out", async ({ page }) => {
  await connectMockWorkspace(page);
  await page.route("**/auth/v1/logout*", route => route.fulfill({ status: 204, body: "" }));
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.locator(".auth-text")).toContainText("Signed out securely.");
  await expect(page.getByRole("button", { name: "Sign out" })).toHaveCount(0);
});
