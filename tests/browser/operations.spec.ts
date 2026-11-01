import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page, request }) => {
  const reset = await request.post("/api/v1/demo/reset", {
    headers: { Authorization: "Bearer browser-test-session" },
  });
  expect(reset.ok()).toBeTruthy();
  await page.addInitScript(() =>
    sessionStorage.setItem("roboops.session-token", "browser-test-session"),
  );
  await page.goto("/");
  await expect(page.getByText("API CONNECTED · DEMO FLEETS")).toBeVisible();
});

test("operator approval, partial delivery, robot application and replanning", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.getByTestId("button-start-review").click();
  await page.getByTestId("button-approve-restriction").click();
  await page.getByTestId("button-dispatch-Moss-03").click();
  await expect(
    page.getByText("Fleet accepted", { exact: true }).last(),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Confirm simulated replan" }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Simulate robot application", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Confirm simulated replan" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Confirm simulated replan" }).click();
  await expect(
    page.getByText("Alternative route confirmed · simulated"),
  ).toBeVisible();
  await page.getByLabel("Simulated dispatch outcome").selectOption("Timed out");
  await page.getByTestId("button-dispatch-Birk-07").click();
  await expect(
    page.getByText("Timed out", { exact: true }).last(),
  ).toBeVisible();
  await page.getByRole("button", { name: "Request clearance review" }).click();
  await page
    .getByLabel("Review rationale")
    .fill("Operator inspected fresh footage and confirms clearance");
  await page
    .getByRole("button", { name: "Approve clearance with notes" })
    .click();
  await page
    .getByLabel("Simulated dispatch outcome")
    .selectOption("Fleet accepted");
  for (let i = 0; i < 2; i++) {
    await page
      .getByRole("button", { name: "Send / retry clearance" })
      .last()
      .click();
    await page
      .getByRole("button", { name: "Simulate clearance applied", exact: true })
      .click();
  }
  await expect(page.getByText("CLEARANCE · CLEARED")).toBeVisible();
  await page.reload();
  await expect(page.getByText("CLEARANCE · CLEARED")).toBeVisible();
  expect(errors).toEqual([]);
});

test("boundary validation, search, settings and illustrative map", async ({
  page,
}) => {
  await expect(page.getByTestId("map-fallback")).toBeVisible();
  await page
    .getByRole("button", { name: "Edit boundary", exact: true })
    .click();
  await page
    .getByLabel("GeoJSON boundary")
    .fill('{"type":"Polygon","coordinates":[[[0,0],[1,1],[1,0],[0,1],[0,0]]]}');
  await page.getByRole("button", { name: "Save proposed boundary" }).click();
  await expect(page.getByRole("alert")).toContainText("self-intersections");
  await page.getByLabel("Search incidents").fill("does-not-exist");
  await expect(page.getByText("No matching observations")).toBeVisible();
  await page.getByTestId("nav-Connections").click();
  await expect(
    page.getByRole("heading", { name: "XProtect & Hafnia" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Test camera access" }),
  ).toBeDisabled();
});

test("mobile navigation and no horizontal page overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByTestId("nav-Fleet profiles").click();
  await expect(
    page.getByRole("heading", { name: "Fleet profiles", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: "test-results/roboops-mobile.png",
    fullPage: true,
  });
});

test("desktop overview screenshot", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(page.getByTestId("map-fallback")).toBeVisible();
  await page.screenshot({
    path: "test-results/roboops-desktop.png",
    fullPage: true,
  });
});

test("gateway imports existing evidence without submitting another analysis", async ({
  page,
}) => {
  let submissions = 0;
  const summaryId = "33333333-3333-4333-8333-333333333333";
  const job = {
    id: "VLM-import",
    cameraId: "11111111-1111-4111-8111-111111111111",
    summaryId,
    progress: "Completed",
    startTime: "2026-11-01T09:00:00Z",
    endTime: "2026-11-01T09:00:30Z",
    response: "OBSTRUCTION_CONFIRMED.",
    message: "Proposed incident created; operator review required.",
    incidentId: "OBS-import",
  };
  await page.route("**/api/v1/hafnia/gateway/jobs", async (route) => {
    if (route.request().method() === "POST") submissions++;
    await route.fulfill({ json: { jobs: [] } });
  });
  await page.route("**/api/v1/hafnia/gateway/import", async (route) => {
    expect(route.request().postDataJSON()).toEqual({ summaryId });
    await page.route("**/api/v1/hafnia/gateway/jobs", (r) =>
      r.fulfill({ json: { jobs: [job] } }),
    );
    await route.fulfill({ json: job });
  });
  await page.getByTestId("nav-Connections").click();
  await page.getByLabel("Existing summary ID").fill(summaryId);
  await page.getByRole("button", { name: "Import existing result" }).click();
  await expect(
    page.getByText("OBSTRUCTION_CONFIRMED.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Proposed incident created; operator review required."),
  ).toBeVisible();
  expect(submissions).toBe(0);
});

test("gateway clip submission requires consent and sends the selected prompt with UTC times", async ({
  page,
}) => {
  const cameraId = "11111111-1111-4111-8111-111111111111";
  const promptId = "22222222-2222-4222-8222-222222222222";
  let sent: Record<string, string> | undefined;
  await page.route("**/api/v1/xprotect/cameras", (r) =>
    r.fulfill({ json: { array: [{ id: cameraId, name: "Scooter" }] } }),
  );
  await page.route("**/api/v1/hafnia/gateway/prompts", (r) =>
    r.fulfill({
      json: {
        prompts: [{ id: promptId, title: "Obstruction prompt" }],
        totalCount: 1,
      },
    }),
  );
  await page.route("**/api/v1/hafnia/gateway/jobs", async (route) => {
    if (route.request().method() === "POST") {
      sent = route.request().postDataJSON();
      await route.fulfill({ json: { id: "VLM-test", progress: "NotStarted" } });
    } else await route.fulfill({ json: { jobs: [] } });
  });
  await page.getByTestId("nav-Connections").click();
  await page.getByRole("button", { name: "Load XProtect cameras" }).click();
  await page
    .getByRole("combobox", { name: "XProtect camera", exact: true })
    .selectOption(cameraId);
  await page
    .getByRole("button", { name: "Load saved gateway prompts" })
    .click();
  await page
    .getByRole("combobox", { name: "Saved gateway prompt" })
    .selectOption(promptId);
  await page.getByLabel("Clip start (UTC)").fill("2026-11-01T09:00");
  await page.getByLabel("Clip end (UTC)").fill("2026-11-01T09:01");
  const submit = page.getByRole("button", { name: "Analyze recorded clip" });
  await expect(submit).toBeDisabled();
  await page
    .getByRole("checkbox", { name: "I intend to submit one new clip analysis" })
    .check();
  await submit.click();
  await expect(submit).toBeDisabled();
  expect(sent).toMatchObject({
    cameraId,
    promptId,
    startTime: "2026-11-01T09:00:00.000Z",
    endTime: "2026-11-01T09:01:00.000Z",
  });
});
