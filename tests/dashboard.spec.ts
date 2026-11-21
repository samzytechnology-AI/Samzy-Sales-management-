import { expect, test } from "@playwright/test";


async function connectMockWorkspace(page: import("@playwright/test").Page, sharedHistory = false) {
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
  const records: Record<string, any[]> = { prospects: [], clients: [], projects: [], products: [], approvals: [], finance: [], outreach: [], contactPoints: [], aiActions: [], tasks: [] };

  await page.route("**/auth/v1/token?grant_type=password", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(session) }));
  await page.route("**/api/ai/run", route => {
    if (route.request().method() === "GET") {
      const messages = sharedHistory ? [
        { id: "shared-user-message", role: "user", actor_user_id: "66666666-6666-4666-8666-666666666666", content: "Shared company handover note." },
        { id: "shared-ai-message", role: "assistant", actor_user_id: null, content: "I have loaded the shared company context." },
      ] : [];
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ conversationId: sharedHistory ? "77777777-7777-4777-8777-777777777777" : null, messages }) });
    }
    const input = route.request().postDataJSON() as Record<string, any>;
    if (String(input.objective ?? "").toLowerCase().includes("create prospect for ai proposal test")) {
      const action = { id: "ai-proposed-from-chat", action_type: "create_prospect", summary: "Add AI Proposal Test Company", payload: { company_name: "AI Proposal Test Company" }, status: "pending_approval", created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 86400000).toISOString() };
      records.aiActions.unshift(action);
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ conversationId: "77777777-7777-4777-8777-777777777777", synthesis: "I prepared the prospect details. Action proposal submitted for approval: Add AI Proposal Test Company. No company record has been changed.", proposedAction: action, warnings: [] }) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ conversationId: "77777777-7777-4777-8777-777777777777", synthesis: "Mock AI response", warnings: [] }) });
  });
  await page.route("**/api/actions", async route => {
    const request = route.request();
    if (request.method() === "GET") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ actions: records.aiActions, canReview: true }) });
    if (request.method() === "POST") {
      const input = request.postDataJSON() as Record<string, any>;
      const action = { id: "ai-action-" + (records.aiActions.length + 1), ...input, action_type: input.actionType, status: "pending_approval", created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 86400000).toISOString() };
      records.aiActions.unshift(action);
      return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ action }) });
    }
    if (request.method() === "PATCH") {
      const input = request.postDataJSON() as Record<string, any>;
      const action = records.aiActions.find(item => item.id === input.id);
      if (action) action.status = input.decision === "approved" ? "executed" : "rejected";
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ result: { status: action?.status, result: { record_id: "created-record" } } }) });
    }
    return route.continue();
  });
  await page.route("**/api/workspace**", async route => {
    const request = route.request();
    if (request.method() === "GET") {
      const summary = { prospects: records.prospects.length, clients: records.clients.length, activeProjects: records.projects.length, pendingApprovals: records.approvals.filter(x => x.status === "pending").length, incomeNgn: 0, expensesNgn: 0, netNgn: 0 };
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ summary, ...Object.fromEntries(Object.entries(records).map(([key, value]) => [key, value])) }) });
      return;
    }
    if (request.method() === "POST") {
      const input = request.postDataJSON() as Record<string, any>;
      const map: Record<string, string> = { client: "clients", project: "projects", prospect: "prospects", contact_point: "contactPoints", finance: "finance", approval: "approvals", product: "products", task: "tasks", outreach_draft: "outreach" };
      const key = map[input.type];
      if (!key) {
        await route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: "Unknown mock record type" }) });
        return;
      }
      const linkedContact = input.type === "outreach_draft" ? records.contactPoints.find(x => x.id === input.contact_point_id) : null;
      const record = { ...input, ...(linkedContact ? { prospect_id: linkedContact.prospect_id, channel: linkedContact.channel, recipient: linkedContact.address, direction: "outbound" } : {}), ...(input.type === "contact_point" ? { address: input.channel === "email" ? String(input.address).toLowerCase() : input.address, is_verified: false } : {}), id: `mock-${records[key].length + 1}`, status: input.type === "approval" ? "pending" : input.type === "outreach_draft" ? "draft" : input.status ?? (input.type === "task" ? "open" : "active"), priority: input.type === "task" ? input.priority ?? "normal" : undefined };
      records[key].unshift(record);
      await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ record }) });
      return;
    }
    if (request.method() === "PATCH") {
      const input = request.postDataJSON() as Record<string, any>;
      if (input.type === "convert_prospect") {
        const prospect = records.prospects.find(x => x.id === input.prospect_id);
        if (!prospect) {
          await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "Prospect not found" }) });
          return;
        }
        prospect.status = "customer";
        let client = records.clients.find(x => x.source_prospect_id === prospect.id);
        if (!client) {
          client = { id: `converted-${prospect.id}`, company_name: prospect.company_name, website_url: prospect.website_url, industry: prospect.industry, source_prospect_id: prospect.id, status: "active" };
          records.clients.push(client);
        }
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ record: client }) });
        return;
      }
      if (input.type === "contact_point_verify") {
        const contact = records.contactPoints.find(x => x.id === input.id);
        if (contact && contact.consent_basis) contact.is_verified = true;
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ record: contact ?? input }) });
        return;
      }
      const key = input.type === "approval" ? "approvals" : input.type === "prospect" ? "prospects" : input.type === "project" ? "projects" : input.type === "task" ? "tasks" : "clients";
      const item = records[key].find(x => x.id === input.id);
      if (item) item.status = input.type === "approval" ? input.decision : input.status;
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
  const approvalForm = page.locator('.record-form:has(textarea[name="description"])');
  expect(await approvalForm.evaluate((form: HTMLFormElement) => form.checkValidity())).toBe(true);
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
  const row = page.locator(".record-row").filter({ hasText: "Prospect Test Company" });
  await row.getByLabel("Status for Prospect Test Company").selectOption("qualified");
  await row.getByRole("button", { name: "Save status" }).click();
  await expect.poll(() => records.prospects[0].status).toBe("qualified");
});

test("authenticated dashboard can create and link a project to a client and prospect", async ({ page }) => {
  const records = await connectMockWorkspace(page);
  records.clients.push({ id: "client-1", company_name: "Project Test Client", status: "active" });
  records.prospects.push({ id: "prospect-1", company_name: "Project Test Prospect", status: "qualified" });
  records.products.push({ id: "product-1", product_name: "Samzy School Cloud", product_key: "school-cloud", status: "healthy" });
  await page.locator("nav").getByRole("button", { name: /Projects/ }).click();
  await page.getByPlaceholder("Project name").fill("Test Website Project");
  await page.getByPlaceholder("Quoted amount (₦)").fill("200000");
  await page.locator('select[name="client_id"]').selectOption("client-1");
  await page.locator('select[name="prospect_id"]').selectOption("prospect-1");
  await page.locator('select[name="product_id"]').selectOption("product-1");
  await page.getByRole("button", { name: "Create project" }).click();
  await expect.poll(() => records.projects.length).toBe(1);
  expect(records.projects[0].client_id).toBe("client-1");
  expect(records.projects[0].prospect_id).toBe("prospect-1");
  expect(records.projects[0].product_id).toBe("product-1");
  await expect(page.getByText("Test Website Project")).toBeVisible();
  const row = page.locator(".record-row").filter({ hasText: "Test Website Project" });
  await row.locator("select").selectOption("in_progress");
  await row.getByRole("button", { name: "Save status" }).click();
  await expect.poll(() => records.projects[0].status).toBe("in_progress");
});

test("authenticated company user can sign out", async ({ page }) => {
  await connectMockWorkspace(page);
  await page.route("**/auth/v1/logout*", route => route.fulfill({ status: 204, body: "" }));
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.locator(".auth-text")).toContainText("Signed out securely.");
  await expect(page.getByRole("button", { name: "Sign out" })).toHaveCount(0);
});

test("CRM converts a prospect into one linked client and refreshes the workspace", async ({ page }) => {
  const records = await connectMockWorkspace(page);
  await page.locator("nav").getByRole("button", { name: /Leads & CRM/ }).click();
  await page.getByPlaceholder("Company name").fill("Conversion Test Company");
  await page.getByPlaceholder("Website URL (optional)").fill("https://conversion-test.example");
  await page.getByRole("button", { name: "Save prospect" }).click();
  await expect.poll(() => records.prospects.length).toBe(1);
  const row = page.locator(".record-row").filter({ hasText: "Conversion Test Company" });
  await row.getByRole("button", { name: "Convert to client" }).click();
  await expect.poll(() => records.clients.length).toBe(1);
  await expect.poll(() => records.prospects[0].status).toBe("customer");
  expect(records.clients[0].source_prospect_id).toBe(records.prospects[0].id);
  await page.locator("nav").getByRole("button", { name: /Clients/ }).click();
  await expect(page.getByText("Conversion Test Company")).toBeVisible();
});

test("overview displays live workspace totals instead of placeholder dashes", async ({ page }) => {
  const records = await connectMockWorkspace(page);
  records.prospects.push({ id: "prospect-overview", company_name: "Overview Prospect", status: "qualified" });
  records.clients.push({ id: "client-overview", company_name: "Overview Client", status: "active" });
  await page.locator("nav").getByRole("button", { name: /Overview/ }).click();
  await expect(page.locator(".metrics")).toContainText("1");
  await expect(page.locator(".metrics")).not.toContainText("CRM integration pending");
});

test("CRM stores prospect contact points as unverified until verification occurs", async ({ page }) => {
  const records = await connectMockWorkspace(page);
  await page.locator("nav").getByRole("button", { name: /Leads & CRM/ }).click();
  await page.getByPlaceholder("Company name").fill("Contact Capture Company");
  await page.getByPlaceholder("Fit score (0–100)").fill("78");
  await page.getByRole("button", { name: "Save prospect" }).click();
  await expect.poll(() => records.prospects.length).toBe(1);
  expect(records.prospects[0].fit_score).toBe(78);
  const row = page.locator(".record-row").filter({ hasText: "Contact Capture Company" });
  await row.getByPlaceholder("Email address or phone number").fill("SALES@EXAMPLE.COM");
  await row.getByPlaceholder("Contact source / consent basis (optional)").fill("Published company contact page");
  await row.getByRole("button", { name: "Add contact" }).click();
  await expect.poll(() => records.contactPoints.length).toBe(1);
  expect(records.contactPoints[0].address).toBe("sales@example.com");
  await expect(row.locator(".contact-points")).toContainText("Unverified");
  await row.getByPlaceholder("How was this contact verified?").fill("Manually checked against the business contact page.");
  await row.getByRole("button", { name: "Confirm verification" }).click();
  await expect.poll(() => records.contactPoints[0].is_verified).toBe(true);
  await expect(row.locator(".contact-points")).toContainText("Manually verified");
});

test("AI General Manager restores shared company history with team attribution", async ({ page }) => {
  await connectMockWorkspace(page, true);
  await expect(page.locator(".messages")).toContainText("Shared company handover note.");
  await expect(page.locator(".messages")).toContainText("Company team");
  await expect(page.locator(".messages")).toContainText("I have loaded the shared company context.");
  await expect(page.locator(".messages")).toContainText("AI General Manager");
});

test("AI action proposals require approval and execute through the controlled action workflow", async ({ page }) => {
  const records = await connectMockWorkspace(page);
  await page.locator("nav").getByRole("button", { name: /Approvals/ }).click();
  await page.getByPlaceholder("Prospect company name").fill("AI Proposed Prospect");
  await page.getByPlaceholder("Website URL (optional)").fill("https://ai-proposed.example");
  await page.getByRole("button", { name: "Submit action for approval" }).click();
  await expect.poll(() => records.aiActions.length).toBe(1);
  expect(records.aiActions[0].status).toBe("pending_approval");
  await expect(page.getByText("AI Proposed Prospect")).toBeVisible();
  await page.getByRole("button", { name: "Approve & execute" }).click();
  await expect.poll(() => records.aiActions[0].status).toBe("executed");
  await expect(page.getByText("executed", { exact: true })).toBeVisible();
});

test("authenticated workspace can create and update linked company tasks", async ({ page }) => {
  const records = await connectMockWorkspace(page);
  records.projects.push({ id: "task-project-1", project_name: "School Website", status: "in_progress" });
  records.clients.push({ id: "task-client-1", company_name: "Task Client", status: "active" });
  await page.locator("nav").getByRole("button", { name: /Tasks/ }).click();
  await page.getByPlaceholder("Task title").fill("Prepare school onboarding checklist");
  await page.getByPlaceholder("Task details / expected outcome").fill("Confirm required school data and migration schedule.");
  await page.locator('select[name="priority"]').selectOption("high");
  await page.locator('select[name="project_id"]').selectOption("task-project-1");
  await page.locator('select[name="client_id"]').selectOption("task-client-1");
  await page.getByRole("button", { name: "Create task" }).click();
  await expect.poll(() => records.tasks.length).toBe(1);
  expect(records.tasks[0].project_id).toBe("task-project-1");
  expect(records.tasks[0].client_id).toBe("task-client-1");
  const row = page.locator(".record-row").filter({ hasText: "Prepare school onboarding checklist" });
  await row.getByLabel("Status for Prepare school onboarding checklist").selectOption("completed");
  await row.getByRole("button", { name: "Save status" }).click();
  await expect.poll(() => records.tasks[0].status).toBe("completed");
});

test("Sales workspace saves eligible outreach as a draft without sending", async ({ page }) => {
  const records = await connectMockWorkspace(page);
  records.prospects.push({ id: "outreach-prospect-1", company_name: "Research Prospect", status: "qualified" });
  records.contactPoints.push({ id: "contact-verified-1", prospect_id: "outreach-prospect-1", channel: "email", address: "hello@research.example", is_verified: true, consent_basis: "Verified published business contact with documented consent" });
  await page.locator("nav").getByRole("button", { name: /Sales & Outreach/ }).click();
  await page.locator('select[name="contact_point_id"]').selectOption("contact-verified-1");
  await page.getByPlaceholder("Write a specific, personalised message for this prospect…").fill("Hello, I reviewed your business website and would like to discuss a possible website improvement project.");
  await page.getByRole("button", { name: "Save outreach draft — do not send" }).click();
  await expect.poll(() => records.outreach.length).toBe(1);
  expect(records.outreach[0].status).toBe("draft");
  expect(records.outreach[0].direction).toBe("outbound");
  await expect(page.getByText("outbound · email · hello@research.example")).toBeVisible();
});

test("AI General Manager can submit a structured prospect proposal to the approval queue", async ({ page }) => {
  await connectMockWorkspace(page);
  await page.getByPlaceholder(/Ask your AI General Manager anything/).fill("Create prospect for AI Proposal Test Company");
  await page.getByRole("button", { name: /Send command/ }).click();
  await expect(page.locator(".messages")).toContainText("Action proposal submitted for approval");
  await page.locator("nav").getByRole("button", { name: /Approvals/ }).click();
  await expect(page.getByText("Add AI Proposal Test Company")).toBeVisible();
  await expect(page.getByText("pending approval", { exact: true })).toBeVisible();
});
