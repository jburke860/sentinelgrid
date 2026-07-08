import { expect, test } from "@playwright/test";

test("dashboard boots the simulated fleet", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /SENTINEL/ })).toBeVisible();
  // The full two-tier fleet reports in (174 flagship + 4,000 mesh).
  await expect(page.locator("header").getByText("/4,174")).toBeVisible({ timeout: 20_000 });
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

test("analytics view shows fingerprint, pattern match, and model confidence", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "Analytics" }).click();
  await expect(page.getByText("Anomaly Fingerprint")).toBeVisible();
  await expect(page.getByText("Pattern match")).toBeVisible();
  await expect(page.getByText("Model Confidence")).toBeVisible();
  await expect(page.getByText("zscore-baseline v0.2").first()).toBeVisible();
});

test("command palette navigates to a region", async ({ page }) => {
  await page.goto("/");
  // Wait for the app to hydrate before sending the shortcut.
  await expect(page.locator(".leaflet-container")).toBeVisible();
  await page.keyboard.press("ControlOrMeta+k");
  const input = page.getByLabel("Command search");
  await expect(input).toBeVisible();
  await input.fill("gulf");
  await page.getByRole("button", { name: /Go to Gulf Coast/ }).click();
  await expect(page.getByLabel("Region", { exact: true })).toHaveValue("gulf");
});

test("incidents view shows the rule-based situation summary", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "Incidents" }).click();
  await expect(page.getByText("Situation Summary")).toBeVisible();
  await expect(page.getByText("auto-generated · rule-based")).toBeVisible();
});

test("shareable URL restores view, theme, and region", async ({ page }) => {
  await page.goto("/#r=gulf&v=analytics&th=dark");
  await expect(page.getByText("Anomaly Fingerprint")).toBeVisible();
  await expect(page.getByLabel("Region", { exact: true })).toHaveValue("gulf");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  // Navigating updates the hash for re-sharing.
  await page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "Incidents" }).click();
  await expect(page).toHaveURL(/v=incidents/);
});

test("perf overlay reports healthy tick cost and bounded marker count", async ({ page }) => {
  await page.goto("/#perf=1");
  await expect(page.locator(".leaflet-container")).toBeVisible();
  const overlay = page.getByTestId("perf-overlay");
  await expect(overlay).toBeVisible();
  // Wait for a real engine tick to be measured, then assert generous CI budgets.
  await expect
    .poll(async () => Number(await page.getByTestId("perf-tick").textContent()), { timeout: 15_000 })
    .toBeGreaterThan(0);
  const tickMs = Number(await page.getByTestId("perf-tick").textContent());
  expect(tickMs).toBeLessThan(50);
  const badges = Number(await page.getByTestId("perf-markers").textContent());
  expect(badges).toBeLessThan(900); // culling keeps the DOM bounded
});

test("help hub opens with ?, and the guided demo drives the app", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".leaflet-container")).toBeVisible();
  // First-visit nudge appears, then ? opens the hub on the Features tab.
  await expect(page.getByText("New here?")).toBeVisible();
  await page.keyboard.press("?");
  await expect(page.getByRole("dialog", { name: "Help" })).toBeVisible();
  await expect(page.getByText("Zoom navigation")).toBeVisible();
  // How-it-works and Shortcuts tabs render.
  await page.getByRole("button", { name: "How it works" }).click();
  await expect(page.getByText("What is real")).toBeVisible();
  // Launch the guided demo: narration toast appears, hub closes.
  await page.getByRole("button", { name: "Features" }).click();
  await page.getByRole("button", { name: /guided demo/i }).click();
  await expect(page.getByRole("dialog", { name: "Help" })).toHaveCount(0);
  await expect(page.getByText(/This is SentinelGrid/)).toBeVisible();
  // Step 2 injects the hurricane and flies to the Gulf.
  await expect(page.getByLabel("Region", { exact: true })).toHaveValue("gulf", { timeout: 12_000 });
  await page.getByRole("button", { name: "skip" }).click();
  await expect(page.getByText(/This is SentinelGrid|Injecting a hurricane/)).toHaveCount(0);
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
