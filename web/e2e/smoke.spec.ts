import { expect, test } from "@playwright/test";

test("dashboard boots the simulated fleet", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /SENTINEL/ })).toBeVisible();
  // All 50 nodes report in.
  await expect(page.locator("header").getByText("/50")).toBeVisible({ timeout: 20_000 });
  // The map mounts with tiles.
  await expect(page.locator(".leaflet-container")).toBeVisible();
});

test("injecting a scenario surfaces an active-hazard badge", async ({ page }) => {
  await page.goto("/#r=socal");
  const inject = page.locator("select", { hasText: "inject scenario" });
  await inject.selectOption("wildfire");
  await expect(page.locator("header .crit-pulse").first()).toBeVisible({ timeout: 15_000 });
});

test("selecting a device shows its telemetry", async ({ page }) => {
  await page.goto("/#r=socal");
  await page.locator("tbody tr").first().click();
  await expect(page.getByText(/Telemetry — (?!select a node)/)).toBeVisible({ timeout: 15_000 });
});

test("rapid region navigation never crashes the heat layer", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  await page.goto("/");
  await expect(page.locator(".leaflet-container")).toBeVisible();
  const regionSelect = page.getByLabel("Region", { exact: true });
  // Fly between regions mid-animation and toggle the heat layer while moving —
  // this used to fire leaflet.heat redraws after layer removal (_map null).
  for (const region of ["socal", "gulf", "", "northeast", "plains", ""]) {
    await regionSelect.selectOption(region);
    await page.waitForTimeout(300);
    await page.getByTitle("Toggle the risk heat layer").click();
  }
  await page.waitForTimeout(1500);
  expect(errors).toEqual([]);
  // The Next.js dev error overlay must not be showing either (the bare
  // nextjs-portal element always exists in dev — it also hosts the toolbar).
  await expect(page.getByText(/Runtime \w*Error/)).toHaveCount(0);
});

test("incident detail opens from the queue", async ({ page }) => {
  await page.goto("/");
  const incident = page.locator("li", { hasText: "INC-" }).first();
  await incident.waitFor({ timeout: 30_000 });
  await incident.click();
  await expect(page.getByText("Timeline")).toBeVisible();
});
