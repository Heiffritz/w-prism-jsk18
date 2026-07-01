const http = require("http");
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const ROOT = __dirname;
const PORT = 8941;
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };

const server = http.createServer((req, res) => {
  const filePath = path.join(ROOT, decodeURIComponent(req.url.split("?")[0]));
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end("not found"); return; }
    res.writeHead(200, { "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream" });
    res.end(data);
  });
});

function assert(cond, msg) {
  if (!cond) throw new Error("ASSERTION FAILED: " + msg);
  console.log("PASS: " + msg);
}
function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

server.listen(PORT, async () => {
  try {
    const dom = await JSDOM.fromURL(`http://localhost:${PORT}/index.html`, {
      runScripts: "dangerously", resources: "usable", pretendToBeVisual: true
    });
    dom.window.fetch = (url, opts) => fetch(`http://localhost:${PORT}/${url}`, opts);

    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const k = dom.window.kernel;
      if (k && k.booted) {
        const am = k.get("assetManager"), vfs = k.get("vfs");
        if (am?.isLoaded() && vfs?.isLoaded()) break;
      }
      await wait(50);
    }

    const window = dom.window;
    const tm = window.kernel.get("themeManager");

    let lastWarning = null;
    const originalWarn = window.console.warn;
    window.console.warn = (...args) => { lastWarning = args.join(" "); };

    let failEventFired = false;
    window.eventBus.on("wallpaper:loadFailed", () => { failEventFired = true; });

    // "bliss.png" doesn't actually exist in this project (real
    // wallpaper images are a deployment-time content task) — this
    // exercises exactly the failure path that was reported.
    window.eventBus.emit("wallpaper:set", { wallpaper: "bliss" });
    await wait(200);

    assert(lastWarning && lastWarning.includes("could not be loaded"), `missing wallpaper file produces a clear console warning (got: "${lastWarning}")`);
    assert(failEventFired, "wallpaper:loadFailed event fires for a genuinely missing file");
    assert(tm.getCurrentWallpaper() !== "bliss", "currentWallpaper does NOT get set to a wallpaper whose file failed to load");

    console.log("\nDIAGNOSTIC VERIFIED");
    server.close();
    process.exit(0);
  } catch (err) {
    console.error("TEST SUITE ERROR:", err);
    server.close();
    process.exit(1);
  }
});
