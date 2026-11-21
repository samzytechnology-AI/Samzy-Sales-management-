import { expect, test } from "@playwright/test";
import { extractAIActionProposal } from "../src/lib/ai/action-proposals";

test("accepts a strictly valid explicit prospect proposal", () => {
  const output = "I can add this prospect.\n[[SAMZY_ACTION_PROPOSAL]]" +
    JSON.stringify({ action_type: "create_prospect", summary: "Add Example Company", payload: { company_name: "Example Company", country: "Nigeria", fit_score: 72 } }) +
    "[[/SAMZY_ACTION_PROPOSAL]]";
  const result = extractAIActionProposal(output);
  expect(result.proposal?.action_type).toBe("create_prospect");
  expect(result.proposal?.payload).toMatchObject({ company_name: "Example Company", fit_score: 72 });
  expect(result.cleanContent).toBe("I can add this prospect.");
  expect(result.warning).toBeUndefined();
});

test("accepts a JSON fenced proposal but strips the marker from the user-facing answer", () => {
  const output = "Prepared.\n[[SAMZY_ACTION_PROPOSAL]]\n```json\n" +
    JSON.stringify({ action_type: "create_project", summary: "Create project record", payload: { project_name: "School Website" } }) +
    "\n```\n[[/SAMZY_ACTION_PROPOSAL]]";
  const result = extractAIActionProposal(output);
  expect(result.proposal?.action_type).toBe("create_project");
  expect(result.cleanContent).toBe("Prepared.");
});

test("rejects unsupported outbound and payment actions", () => {
  const output = "I will send it.\n[[SAMZY_ACTION_PROPOSAL]]" +
    JSON.stringify({ action_type: "send_whatsapp", summary: "Send WhatsApp", payload: { recipient: "+234..." } }) +
    "[[/SAMZY_ACTION_PROPOSAL]]";
  const result = extractAIActionProposal(output);
  expect(result.proposal).toBeUndefined();
  expect(result.warning).toContain("failed validation");
});

test("rejects multiple action proposals instead of choosing one", () => {
  const one = "[[SAMZY_ACTION_PROPOSAL]]" + JSON.stringify({ action_type: "create_prospect", summary: "Add one", payload: { company_name: "One Company" } }) + "[[/SAMZY_ACTION_PROPOSAL]]";
  const result = extractAIActionProposal(one + "\n" + one);
  expect(result.proposal).toBeUndefined();
  expect(result.warning).toContain("multiple action proposals");
  expect(result.cleanContent).toBe("");
});

test("discards an otherwise valid proposal when coordinated synthesis is unavailable", () => {
  const output = "[[SAMZY_ACTION_PROPOSAL]]" +
    JSON.stringify({ action_type: "create_prospect", summary: "Add Example Company", payload: { company_name: "Example Company" } }) +
    "[[/SAMZY_ACTION_PROPOSAL]]";
  const result = extractAIActionProposal(output, false);
  expect(result.proposal).toBeUndefined();
  expect(result.warning).toContain("synthesis was unavailable");
  expect(result.cleanContent).toBe("");
});
