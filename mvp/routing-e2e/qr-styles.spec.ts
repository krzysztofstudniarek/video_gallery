import { expect, test } from "@playwright/test";
import jsQR from "jsqr";
import { home, origin, owner, signedIn } from "./support";

const watch = "https://www.youtube.com/watch?v=synthetic61";
const privateWatch = "https://www.youtube.com/watch?v=synthetic62";
const styles = [
  { id: 1, name: "Classic Black", ink: "#111111" },
  { id: 2, name: "Warm Sepia", ink: "#563b29" },
  { id: 3, name: "Botanical Green", ink: "#1d4b35" },
  { id: 4, name: "Navy Minimal", ink: "#17324f" },
];
for (const style of styles) {
  test(`${style.name} saved SVG independently decodes to the direct destination; Private stays JSON-only`, async ({ page }) => {
    await signedIn(page);
    await page.route("**/functions/v1/uploads", (route) => {
      const action = route.request().postDataJSON().action;
      return route.fulfill({
        contentType: "application/json",
        headers: { "Access-Control-Allow-Origin": origin },
        json: action === "delivery"
          ? {
            workflowId: owner,
            expiresAt: new Date(Date.now() + 86400000).toISOString(),
            albumId: owner,
            albumTitle: "Four styles",
            preset: 1,
            jobs: [{
              jobId: owner,
              caption: "Public card",
              state: "uploaded",
              visibility: "public",
              qrEligible: true,
            }, {
              jobId: "00000000-0000-4000-8000-000000000027",
              caption: "Private caption",
              state: "uploaded",
              visibility: "private",
              qrEligible: false,
            }],
          }
          : action === "downloads"
          ? {
            workflowId: owner,
            batchId: owner,
            expiresAt: new Date(Date.now() + 240000).toISOString(),
            albumTitle: "Four styles",
            preset: style.id,
            entries: [{
              jobId: owner,
              videoId: owner,
              caption: "Public card",
              visibility: "public",
              qrEligible: true,
              destination: watch,
            }, {
              jobId: "00000000-0000-4000-8000-000000000027",
              videoId: owner,
              caption: "Private caption",
              visibility: "private",
              qrEligible: false,
              destination: privateWatch,
            }],
          }
          : { acknowledged: true },
      });
    });
    await page.goto(home + `workflows/${owner}/print`);
    await page.getByLabel("QR style").selectOption(String(style.id));
    await page.getByRole("checkbox", { name: /I have checked the intended/ }).check();
    await page.getByRole("button", { name: "Prepare verified files" }).click();
    await expect(page.locator(".qr-sheet svg")).toHaveCount(1);
    await expect(page.locator(".qr-sheet")).not.toContainText("Private caption");
    await expect(page.getByRole("button", { name: /Download SVG/ })).toHaveCount(1);
    const svgPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download SVG 1", exact: true }).click();
    const svg = await svgPromise;
    const svgStream = await svg.createReadStream();
    let source = "";
    for await (const data of svgStream!) source += data.toString();
    await svg.delete();
    expect(source).toContain('width="32mm" height="32mm"');
    expect(source).toContain(`fill="${style.ink}"`);
    // Decode rasterized saved bytes with an independent decoder, not the app's QR encoder.
    await page.route(
      home + "__saved-code.svg",
      (route) => route.fulfill({ contentType: "image/svg+xml", body: source }),
    );
    const pixels = await page.evaluate(async (url) => {
      const image = new Image();
      const ready = new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error("Saved SVG could not render"));
      });
      image.src = url;
      await ready;
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 512;
      const context = canvas.getContext("2d")!;
      context.drawImage(image, 0, 0, 512, 512);
      return Array.from(context.getImageData(0, 0, 512, 512).data);
    }, home + "__saved-code.svg");
    expect(jsQR(new Uint8ClampedArray(pixels), 512, 512)?.data).toBe(watch);
    const sheetPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download A4 sheet" }).click();
    const sheet = await sheetPromise;
    const sheetStream = await sheet.createReadStream();
    let html = "";
    for await (const data of sheetStream!) html += data.toString();
    await sheet.delete();
    expect(html).toContain(source);
    expect(html).not.toContain("Private caption");
    expect(html).toContain("size:A4");
    const jsonPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download captions and links" }).click();
    const json = await jsonPromise;
    const jsonStream = await json.createReadStream();
    let text = "";
    for await (const data of jsonStream!) text += data.toString();
    await json.delete();
    const exported = JSON.parse(text);
    expect(exported.preset).toBe(style.id);
    expect(exported.entries.map((entry: { youtubeWatchUrl: string }) => entry.youtubeWatchUrl))
      .toEqual([watch, privateWatch]);
    expect(exported.entries[1].visibility).toBe("private");
  });
}
