import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const distDir = resolve(fileURLToPath(new URL("./dist/", import.meta.url)));
const port = Number(process.env.PORT || 8080);

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

const server = createServer(async (req, res) => {
  try {
    const method = req.method || "GET";

    if (method !== "GET" && method !== "HEAD") {
      res.writeHead(405, { Allow: "GET, HEAD" });
      res.end();
      return;
    }

    let pathname;
    try {
      pathname = decodeURIComponent(
        new URL(req.url || "/", "http://localhost").pathname,
      );
    } catch {
      res.writeHead(400);
      res.end("Bad Request");
      return;
    }

    if (pathname === "/health") {
      const body = Buffer.from(JSON.stringify({
        status: "ok",
        service: "urumi-dashboard",
      }));
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": body.length,
      });
      res.end(method === "HEAD" ? undefined : body);
      return;
    }

    const filePath = resolve(distDir, `.${pathname}`);

    if (filePath !== distDir && !filePath.startsWith(distDir + sep)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    let selectedFile = filePath;

    try {
      const info = await stat(filePath);
      if (info.isDirectory()) {
        selectedFile = resolve(filePath, "index.html");
      } else if (!info.isFile()) {
        throw new Error("Not a regular file");
      }
    } catch {
      if (extname(pathname)) {
        res.writeHead(404);
        res.end("Not Found");
        return;
      }
      selectedFile = resolve(distDir, "index.html");
    }

    const body = await readFile(selectedFile);
    const extension = extname(selectedFile).toLowerCase();

    res.writeHead(200, {
      "Content-Type": contentTypes[extension] || "application/octet-stream",
      "Content-Length": body.length,
      "Cache-Control": extension === ".html" ? "no-cache" : "public, max-age=300",
    });
    res.end(method === "HEAD" ? undefined : body);
  } catch (error) {
    console.error("Dashboard request failed:", error);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    }
    res.end("Internal Server Error");
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Urumi dashboard listening on port ${port}`);
});