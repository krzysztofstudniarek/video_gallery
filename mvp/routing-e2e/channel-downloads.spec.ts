import { expect, type Page, test } from "@playwright/test";
import jsQR from "jsqr";
import { home, origin, owner, signedIn } from "./support";

const videos = [
  { id: "existing001", title: "First selected <video>", processed: true },
  { id: "existing002", title: "Not selected", processed: true },
  { id: "existing003", title: "Third selected", processed: true },
  { id: "existing004", title: "Still processing", processed: false },
];
async function setup(page: Page, lifetime = 3600000) {
  await signedIn(page);
  const expiresAt = new Date(Date.now() + lifetime).toISOString();
  const requests: Record<string, unknown>[] = [];
  let rejected = false;
  let hold: Promise<void> | undefined;
  await page.route("**/functions/v1/channel-library", async (route) => {
    const input = route.request().postDataJSON();
    requests.push(input);
    const destinations = input.action === "destinations";
    if (destinations) await hold;
    await route.fulfill({
      status: destinations && rejected ? 409 : 200,
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": origin },
      json: destinations
        ? rejected ? { error: "channel_selection_changed" } : {
          workflowId: owner,
          expiresAt: new Date(Math.min(Date.parse(expiresAt), Date.now() + 300000)).toISOString(),
          entries: (input.videoIds as string[]).map((id) => ({
            id,
            caption: videos.find((v) => v.id === id)!.title,
            destination: `https://www.youtube.com/watch?v=${id}`,
            visibility: "unlisted",
            qrEligible: true,
          })),
        }
        : {
          connected: true,
          workflowId: owner,
          expiresAt,
          items: videos,
          nextPageToken: null,
        },
    });
  });
  await page.goto(home + "videos");
  await page.getByRole("checkbox", { name: "Select Third selected for QR code", exact: true })
    .check();
  await page.getByRole("checkbox", {
    name: "Select First selected <video> for QR code",
    exact: true,
  }).check();
  await page.getByRole("checkbox", {
    name: "I will keep these sensitive downloads for reprinting.",
  }).check();
  return {
    requests,
    reject: () => rejected = true,
    hold: (promise: Promise<void>) => hold = promise,
  };
}

async function file(page: Page, button: string) {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: button, exact: true }).click();
  const download = await pending;
  const stream = await download.createReadStream();
  let content = "";
  for await (const chunk of stream!) content += chunk.toString();
  await download.delete();
  return content;
}

for (const style of [1, 2, 3, 4]) {
  test(`existing channel selection downloads style ${style} in list order with only selected direct URLs`, async ({ page }) => {
    const f = await setup(page);
    await expect(page.getByRole("checkbox", { name: "Select Still processing for QR code" }))
      .toBeDisabled();
    await page.getByRole("combobox", { name: "QR style", exact: true }).selectOption(String(style));
    await page.getByRole("button", { name: "Prepare selected Unlisted QR files" }).click();
    await expect(page.locator(".qr-sheet article")).toHaveCount(2);
    await page.evaluate(() => globalThis.dispatchEvent(new Event("focus")));
    await expect(page.locator(".qr-sheet article")).toHaveCount(2);
    const svg = await file(page, "Download selected SVG 1");
    const sheet = await file(page, "Download selected A4 sheet");
    const links = JSON.parse(await file(page, "Download selected captions and links"));
    expect(links.preset).toBe(style);
    expect(links.entries.map((entry: { youtubeWatchUrl: string }) => entry.youtubeWatchUrl))
      .toEqual([
        "https://www.youtube.com/watch?v=existing001",
        "https://www.youtube.com/watch?v=existing003",
      ]);
    expect(sheet).toContain("First selected &lt;video&gt;");
    expect(sheet).not.toContain("Not selected");
    expect(sheet).not.toContain("Still processing");
    expect(sheet).toContain(svg);
    expect(f.requests.filter((r) => r.action === "destinations")).toHaveLength(4);
    for (const request of f.requests.filter((r) => r.action === "destinations")) {
      expect(request).toEqual({
        action: "destinations",
        workflowId: owner,
        videoIds: ["existing001", "existing003"],
      });
    }
    // Saved QR bytes decode independently after the app/backend go offline.
    await page.route(
      home + "__saved-channel-code.svg",
      (route) => route.fulfill({ contentType: "image/svg+xml", body: svg }),
    );
    const pixels = await page.evaluate(async (url) => {
      const image = new Image();
      image.src = url;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 512;
      const context = canvas.getContext("2d")!;
      context.drawImage(image, 0, 0, 512, 512);
      return Array.from(context.getImageData(0, 0, 512, 512).data);
    }, home + "__saved-channel-code.svg");
    await page.context().setOffline(true);
    expect(jsQR(new Uint8ClampedArray(pixels), 512, 512)?.data).toBe(
      "https://www.youtube.com/watch?v=existing001",
    );
    await page.context().setOffline(false);
    const storage = await page.evaluate(() =>
      JSON.stringify({ ...localStorage, ...sessionStorage, history: history.state })
    );
    expect(storage).not.toContain("existing001");
    expect(storage).not.toContain("First selected");
    await page.reload();
    await expect(page.locator(".qr-sheet")).toHaveCount(0);
    await expect(page.getByText("0 videos selected for QR codes.")).toBeVisible();
  });
}

test("a stale channel preview cannot download after a provider/privacy change", async ({ page }) => {
  const f = await setup(page);
  await page.getByRole("button", { name: "Prepare selected Unlisted QR files" }).click();
  await expect(page.locator(".qr-sheet article")).toHaveCount(2);
  let downloads = 0;
  page.on("download", () => downloads++);
  f.reject();
  await page.getByRole("button", { name: "Download selected A4 sheet" }).click();
  await expect(page.getByText("A selected YouTube video is no longer available. Refresh videos."))
    .toBeVisible();
  await expect(page.locator(".qr-sheet")).toHaveCount(0);
  expect(downloads).toBe(0);
});

test("disconnect discards late channel verification and clears selection and preview", async ({ page }) => {
  const f = await setup(page);
  let release!: () => void;
  f.hold(new Promise<void>((resolve) => release = resolve));
  await page.getByRole("button", { name: "Prepare selected Unlisted QR files" }).click();
  await expect(page.getByText("Checking selected videos…")).toBeVisible();
  await page.evaluate(() => {
    const channel = new BroadcastChannel("videoalbum:stop-provider");
    channel.postMessage("stop");
    channel.close();
  });
  await expect(page.getByText("0 videos selected for QR codes.")).toBeVisible();
  release();
  await expect(page.locator(".qr-sheet")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("First selected");
});

test("channel workflow expiry clears a prepared preview and disables new downloads", async ({ page }) => {
  await page.clock.install();
  await setup(page, 60000);
  await page.getByRole("button", { name: "Prepare selected Unlisted QR files" }).click();
  await expect(page.locator(".qr-sheet article")).toHaveCount(2);
  await page.clock.fastForward(60001);
  await expect(page.locator(".qr-sheet")).toHaveCount(0);
  await expect(page.getByText("0 videos selected for QR codes.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Download selected A4 sheet" })).toHaveCount(0);
});

test("changing channel selection invalidates prepared files", async ({ page }) => {
  await setup(page);
  await page.getByRole("button", { name: "Prepare selected Unlisted QR files" }).click();
  await expect(page.locator(".qr-sheet article")).toHaveCount(2);
  await page.getByRole("checkbox", { name: "Select Not selected for QR code", exact: true })
    .check();
  await expect(page.locator(".qr-sheet")).toHaveCount(0);
  await expect(
    page.getByRole("checkbox", { name: "I will keep these sensitive downloads for reprinting." }),
  ).not.toBeChecked();
});
