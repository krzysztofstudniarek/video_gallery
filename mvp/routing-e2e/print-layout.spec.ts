import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { home, origin, owner, signedIn } from "./support";

// Exercise the built UI and the actual saved HTML, then check Chromium's paginated output.
// Poppler is used only by this print acceptance test, never by the app.
test("A4 preview and downloaded sheet keep 50 codes with long captions inside page margins", async ({ page }) => {
  await signedIn(page);
  const captions = Array.from({ length: 50 }, (_, index) => {
    const text = index === 1
      ? "W".repeat(1900)
      : index === 2
      ? "word\n".repeat(380)
      : index === 3
      ? "\n".repeat(1900)
      : index === 4
      ? "word ".repeat(45)
      : `A caption for the physical album card ${index + 1}.`;
    return `START${index} ${text} END${index}`;
  });
  const entries = captions.map((caption, index) => ({
    jobId: `${owner.slice(0, -2)}${String(index).padStart(2, "0")}`,
    videoId: owner,
    caption,
    visibility: "unlisted",
    qrEligible: true,
    destination: `https://www.youtube.com/watch?v=synthetic${String(index).padStart(2, "0")}`,
  }));
  await page.route("**/functions/v1/uploads", (route) => {
    const action = route.request().postDataJSON().action;
    return route.fulfill({
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": origin },
      json: action === "delivery"
        ? {
          workflowId: owner,
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
          albumId: owner,
          albumTitle: "Print layout acceptance",
          preset: 1,
          jobs: entries.map((entry) => ({ ...entry, state: "uploaded", processing: "succeeded" })),
        }
        : action === "downloads"
        ? {
          workflowId: owner,
          batchId: owner,
          expiresAt: new Date(Date.now() + 300000).toISOString(),
          albumTitle: "Print layout acceptance",
          preset: 1,
          entries,
        }
        : { acknowledged: true },
    });
  });
  await page.goto(home + `workflows/${owner}/print`);
  await page.getByRole("checkbox", { name: /I have checked the intended/ }).check();
  await page.getByRole("button", { name: "Prepare verified files" }).click();
  await expect(page.locator(".qr-sheet article")).toHaveCount(50);
  await page.emulateMedia({ media: "print" });
  await expect(page.getByRole("navigation")).toBeHidden();
  const width = await page.locator(".qr-sheet svg").first().evaluate((el) =>
    el.getBoundingClientRect().width
  );
  expect(width * 25.4 / 96).toBeCloseTo(32, 1);
  const directory = await mkdtemp(join(tmpdir(), "videoalbum-print-"));
  try {
    const preview = join(directory, "preview.pdf");
    await page.pdf({ path: preview, preferCSSPageSize: true, printBackground: true });
    await page.emulateMedia({ media: "screen" });
    const pending = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download A4 sheet", exact: true }).click();
    const download = await pending;
    const html = await readFile((await download.path())!, "utf8");
    await download.delete();
    await page.route(
      home + "__saved-sheet.html",
      (route) => route.fulfill({ contentType: "text/html", body: html }),
    );
    await page.goto(home + "__saved-sheet.html");
    await page.emulateMedia({ media: "print" });
    const sheet = join(directory, "sheet.pdf");
    await page.pdf({ path: sheet, preferCSSPageSize: true, printBackground: true });
    const texts: string[][] = [];
    for (const pdf of [preview, sheet]) {
      const info = execFileSync("pdfinfo", [pdf], { encoding: "utf8" });
      const dimensions = info.match(/Page size:\s+([\d.]+) x ([\d.]+) pts \(A4\)/);
      expect(dimensions, info).not.toBeNull();
      expect(Math.abs(Number(dimensions![1]) - 210 * 72 / 25.4)).toBeLessThan(0.5);
      expect(Math.abs(Number(dimensions![2]) - 297 * 72 / 25.4)).toBeLessThan(0.5);
      const xml = execFileSync("pdftotext", ["-bbox", pdf, "-"], { encoding: "utf8" });
      const pages = xml.split("<page ").slice(1);
      expect(pages.length).toBeGreaterThan(1);
      const text = pages.map((p) => p.replace(/<[^>]+>/g, " ").replace(/\s+/g, " "));
      texts.push(text);
      for (let index = 0; index < 50; index++) {
        const matching = text.filter((p) => p.includes(`START${index} `));
        expect(matching).toHaveLength(1);
        expect(matching[0]).toContain(`END${index} `);
      }
      expect(text.join(" ")).not.toContain("Main navigation");
      expect(text.join(" ")).not.toContain("Finish workflow");
      for (
        const word of xml.matchAll(
          /<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)"/g,
        )
      ) {
        expect(Number(word[1])).toBeGreaterThanOrEqual(33);
        expect(Number(word[2])).toBeGreaterThanOrEqual(33);
        expect(Number(word[3])).toBeLessThan(563);
        expect(Number(word[4])).toBeLessThan(809);
      }
    }
    expect(texts[0]).toEqual(texts[1]);
    // Keep synthetic-only artifacts for visual acceptance inspection when requested.
    if (process.env.PRINT_REVIEW_DIR) {
      const { mkdir, copyFile } = await import("node:fs/promises");
      await mkdir(process.env.PRINT_REVIEW_DIR, { recursive: true });
      await copyFile(preview, join(process.env.PRINT_REVIEW_DIR, "preview.pdf"));
      await copyFile(sheet, join(process.env.PRINT_REVIEW_DIR, "sheet.pdf"));
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("workflow print choices survive Back/Forward; returning only reads delivery", async ({ page }) => {
  await signedIn(page);
  const actions: string[] = [];
  await page.route("**/functions/v1/uploads", (route) => {
    const action = route.request().postDataJSON().action;
    actions.push(action);
    return route.fulfill({
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": origin },
      json: {
        workflowId: owner,
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        albumId: owner,
        albumTitle: "Navigation choices",
        preset: 1,
        jobs: [{
          jobId: owner,
          caption: "A video",
          state: "uploaded",
          processing: "succeeded",
          visibility: "unlisted",
          qrEligible: true,
        }],
      },
    });
  });
  await page.goto(home + `workflows/${owner}/print`);
  await page.getByRole("combobox", { name: "QR style", exact: true }).selectOption("3");
  await page.getByLabel("Number codes").uncheck();
  await page.getByRole("checkbox", { name: /I have checked the intended/ }).check();
  await page.getByRole("link", { name: "Home", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Home", exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("combobox", { name: "QR style", exact: true })).toHaveValue("3");
  await expect(page.getByLabel("Number codes")).not.toBeChecked();
  await expect(page.getByRole("checkbox", { name: /I have checked the intended/ })).not
    .toBeChecked();
  await expect(page.locator(".qr-sheet")).toHaveCount(0);
  expect(actions).toEqual(["delivery", "delivery"]);
  await page.reload();
  await expect(page.getByRole("combobox", { name: "QR style", exact: true })).toHaveValue("1");
  await expect(page.getByLabel("Number codes")).toBeChecked();
});
