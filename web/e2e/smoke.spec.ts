import { expect, test } from "@playwright/test";

test("dashboard boots the simulated fleet", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /SENTINEL/ })).toBeVisible();
  // All 150 nodes report in.
  await expect(page.locator("header").getByText("/150")).toBeVisible({ timeout: 20_000 });
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

test("zooming drills into a region and back out to national, no clicks", async ({ page }) => {
  await page.goto("/");
  const map = page.locator(".leaflet-container");
  await expect(map).toBeVisible();
  await expect(page.getByText("Live Fleet Map — National Overview")).toBeVisible();

  // Scroll-zoom into the middle of the country: the nearest region should be
  // adopted automatically once device-level zoom is reached.
  const box = (await map.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 6; i++) {
    await page.mouse.wheel(0, -240);
    await page.waitForTimeout(250);
  }
  await expect(page.getByText(/Live Fleet Map — (?!National Overview)/)).toBeVisible({
    timeout: 5_000,
  });

  // Scroll back out: the selection returns to the national overview.
  for (let i = 0; i < 8; i++) {
    await page.mouse.wheel(0, 240);
    await page.waitForTimeout(250);
  }
  await expect(page.getByText("Live Fleet Map — National Overview")).toBeVisible({
    timeout: 5_000,
  });
});

test("incident detail opens from the queue", async ({ page }) => {
  await page.goto("/");
  const incident = page.locator("li", { hasText: "INC-" }).first();
  await incident.waitFor({ timeout: 30_000 });
  // Click the incident key (not the card center — that hits the title button,
  // which selects the device rather than expanding the card).
  await incident.locator("span", { hasText: "INC-" }).first().click();
  await expect(page.getByText("Timeline")).toBeVisible();
});
