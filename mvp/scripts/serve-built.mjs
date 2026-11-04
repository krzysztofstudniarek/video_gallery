import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, sep } from "node:path";

// Local test server for the built artifact and checked-in Vercel headers/rewrites.
// It never connects to a hosted backend or records request URLs (which may carry OAuth fixtures).
const root = resolve("dist");
const base = process.env.ROUTING_BASE_PATH || "/";
const config = JSON.parse(await readFile("vercel.json", "utf8"));
const headers = Object.fromEntries(config.headers[0].headers.map(({ key, value }) => [key, value]));
const fallback = new RegExp(`^${config.rewrites[0].source}$`);
const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
};
createServer(async (request, response) => {
  try {
    const url = new URL(request.url, "http://127.0.0.1:5174");
    const path = decodeURIComponent(url.pathname);
    if (!path.startsWith(base)) throw new Error("not_found");
    const route = `/${path.slice(base.length)}`;
    let file = resolve(root, `.${route}`);
    if (!file.startsWith(root + sep) && file !== root) throw new Error("not_found");
    const exists = await stat(file).then((entry) => entry.isFile()).catch(() => false);
    if (!exists) {
      if (!fallback.test(route)) throw new Error("not_found");
      file = resolve(root, "index.html");
    }
    const extension = file.slice(file.lastIndexOf("."));
    response.writeHead(200, {
      ...headers,
      "Content-Type": types[extension] || "application/octet-stream",
    });
    response.end(await readFile(file));
  } catch {
    response.writeHead(404, { ...headers, "Content-Type": "text/plain" });
    response.end("Not found");
  }
}).listen(5174, "127.0.0.1");
