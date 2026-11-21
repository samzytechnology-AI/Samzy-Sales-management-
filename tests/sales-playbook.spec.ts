import { expect, test } from "@playwright/test";
import { SALES_CONVERSION_PLAYBOOK } from "../src/lib/ai/sales-playbook";

test("sales playbook prioritises qualified profitable client conversion", () => {
  expect(SALES_CONVERSION_PLAYBOOK).toContain("qualified revenue");
  expect(SALES_CONVERSION_PLAYBOOK).toContain("FIT BEFORE PITCH");
  expect(SALES_CONVERSION_PLAYBOOK).toContain("service fit 25");
  expect(SALES_CONVERSION_PLAYBOOK).toContain("evidence coverage and confidence separately");
  expect(SALES_CONVERSION_PLAYBOOK).toContain("CONVERSION PLAN");
});

test("sales forecasts must disclose uncertainty and include alternative outcomes", () => {
  expect(SALES_CONVERSION_PLAYBOOK).toContain("alternative responses including silence or rejection");
  expect(SALES_CONVERSION_PLAYBOOK).toContain("confidence as low/medium/high");
  expect(SALES_CONVERSION_PLAYBOOK).toContain("Use numeric probabilities only when sufficient comparable historical outcomes exist");
  expect(SALES_CONVERSION_PLAYBOOK).toContain("Never say a recipient will surely reply");
});

test("client messages must remain evidence-led, natural and commercially honest", () => {
  expect(SALES_CONVERSION_PLAYBOOK).toContain("one specific, verified observation");
  expect(SALES_CONVERSION_PLAYBOOK).toContain("Never argue, guilt, fabricate social proof");
  expect(SALES_CONVERSION_PLAYBOOK).toContain("protect Samzy's pricing floors");
});
