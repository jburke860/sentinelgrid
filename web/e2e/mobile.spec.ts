import { expect, test } from "@playwright/test";

// Phone-layout guardrails (runs only in the "mobile" project: 390x844, touch).
// These pin the invariants from the mobile revamp: a one-row header with the
// desktop controls collapsed into a bottom sheet, the map layers list as a
// sheet, the two-panel overview, card-style node rows, and no horizontal
// overflow anywhere.

async function ready(page: import("@playwright/test").Page) {
  await page.goto("/");
  await expect(page.locator(".leaflet-container")).toBeVisible();
  await expect(page.locator("header").getByText("/4,174")).toBeVisible({ timeout: 20_000 });
}

test("phone header collapses to one row and nothing overflows horizontally", async ({ page }) => {
  await ready(page);
  // Desktop-only controls are hidden; the sheet trigger and search remain.
  await expect(page.getByRole("button", { name: "autopilot" })).toBeHidden();
  await expect(page.getByLabel("Open console controls")).toBeVisible();
  // Every view renders without sideways scroll.
  for (const tab of ["Incidents", "Nodes", "Analytics", "Overview"]) {
    await page.getByRole("navigation", { name: "Views" }).getByRole("button", { name: tab }).click();
    await page.waitForTimeout(400);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, `${tab} view overflows horizontally`).toBeLessThanOrEqual(0);
  }
});

test("console-controls sheet toggles the theme and speed", async ({ page }) => {
  await ready(page);
  await page.getByLabel("Open console controls").click();
  const sheet = page.getByRole("dialog", { name: "Console controls" });
  await expect(sheet).toBeVisible();
  await sheet.getByRole("button", { name: /Dark theme/ }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await sheet.getByRole("button", { name: "4x speed" }).click();
  await sheet.getByRole("button", { name: "Close" }).click();
  await expect(sheet).toHaveCount(0);
});

test("map layers open as a bottom sheet and toggles stick", async ({ page }) => {
  await ready(page);
  await page.getByRole("button", { name: /Map layers/ }).click();
  const sheet = page.getByRole("dialog", { name: "Map layers" });
  await expect(sheet).toBeVisible();
  const risk = sheet.getByRole("button", { name: /Risk heat/ });
  await expect(risk).toHaveAttribute("aria-pressed", "false");
  await risk.click();
  await expect(risk).toHaveAttribute("aria-pressed", "true");
  await sheet.getByRole("button", { name: "Close" }).click();
  await expect(sheet).toHaveCount(0);
});

test("overview keeps two panels; nodes view renders cards, not the table", async ({ page }) => {
  await ready(page);
  await expect(page.locator("main section.sg-panel:visible")).toHaveCount(2);
  await page.getByRole("navigation", { name: "Views" }).getByRole("button", { name: "Nodes" }).click();
  // Card rows carry the batt/temp secondary line; the 7-col table stays hidden.
  await expect(page.getByText(/batt \d+%/).first()).toBeVisible({ timeout: 10_000 });
  await expect(page.locator("main table:visible")).toHaveCount(0);
});

test("touch nudge starts the guided demo directly", async ({ page }) => {
  await ready(page);
  await expect(page.getByText("Take the 60-second feature tour")).toBeVisible();
  await page.getByRole("button", { name: "start" }).click();
  await expect(page.getByText(/This is SentinelGrid/)).toBeVisible();
  // Step 2 flies to the Gulf, proving the demo drives real handlers here too.
  await expect(page.getByLabel("Region", { exact: true })).toHaveValue("gulf", { timeout: 12_000 });
  await page.getByRole("button", { name: "skip" }).click();
  await expect(page.getByText(/This is SentinelGrid|Injecting a hurricane/)).toHaveCount(0);
});
