/**
 * main.js
 * ------------------------------------------------------------------
 * OS entry point. Loaded last in index.html, after every core,
 * runtime, and app script.
 *
 * PHASE 8 STATE:
 * Kernel boots:
 *   EventBus -> ThemeManager -> ProcessManager -> AssetManager -> VFS
 *   -> WindowManager -> ContextMenuEngine -> DesktopEngine
 *   -> TaskbarEngine -> StartMenuEngine
 *
 * Bootloader is constructed FIRST, before `new Kernel()`, because it
 * listens for "kernel:ready" / "asset:ready" / "vfs:ready" and
 * EventBus does not replay past events to late subscribers — it must
 * already be listening before boot() fires those events.
 *
 * The dev log panel from Phases 1-7 is now OFF by default — it was a
 * debugging aid, not part of the OS surface, and leaving it visible
 * would undercut Phase 8's whole point (making this look like a real
 * OS). It can still be turned on by appending ?debug=1 to the URL,
 * which is useful for verifying boot order without editing this file.
 * ------------------------------------------------------------------ */

(function () {
  "use strict";

  const DEBUG = new URLSearchParams(window.location.search).get("debug") === "1";

  function log(text) {
    if (!DEBUG) return;
    let el = document.getElementById("kernel-log");
    if (!el) {
      el = document.createElement("pre");
      el.id = "kernel-log";
      el.style.cssText =
        "position:fixed;bottom:40px;left:0;margin:0;padding:8px;" +
        "font-family:Consolas,monospace;font-size:10px;color:#9cf;" +
        "background:rgba(0,16,32,0.8);white-space:pre-wrap;" +
        "max-width:420px;max-height:200px;overflow:auto;" +
        "box-sizing:border-box;z-index:999999;pointer-events:none;";
      document.body.appendChild(el);
    }
    el.textContent += text + "\n";
    el.scrollTop = el.scrollHeight;
  }

  window.addEventListener("DOMContentLoaded", () => {
    const bus = window.eventBus;
    if (DEBUG) bus.enableTrace();

    log("Windows Prism JSK — PHASE 8 (UI polish + theming)");
    log("------------------------------------------------");

    // Bootloader must be constructed BEFORE `new Kernel()` so its
    // event listeners are already registered when boot() fires
    // kernel:ready / asset:ready / vfs:ready synchronously.
    const bootloader = new Bootloader(bus, { minDisplayMs: 1100 });
    window.bootloader = bootloader; // exposed for console debugging during dev

    bus.on("kernel:bootStep", ({ name, ok }) => {
      log(`[boot] ${name} ... ${ok ? "OK" : "FAILED"}`);
    });
    bus.on("window:created", ({ windowId }) => log(`[window] created ${windowId}`));
    bus.on("window:closed", ({ windowId }) => log(`[window] closed ${windowId}`));
    bus.on("process:spawned", ({ pid, appId }) => log(`[process] spawned pid=${pid} appId=${appId}`));
    bus.on("process:killed", ({ pid }) => log(`[process] killed pid=${pid}`));
    bus.on("process:appRegistered", ({ appId }) => log(`[process] app registered: ${appId}`));
    bus.on("theme:applied", ({ theme }) => log(`[theme] applied: ${theme}`));

    bus.on("asset:ready", ({ count }) => log(`[asset] registry loaded — ${count} keys`));
    bus.on("asset:loadFailed", ({ url }) => log(`[asset] FAILED to load ${url}`));
    bus.on("vfs:ready", ({ rootName }) => {
      log(`[vfs] file system loaded — root: "${rootName}"`);
      if (DEBUG) runVfsSelfTest();
    });
    bus.on("vfs:loadFailed", ({ url }) => log(`[vfs] FAILED to load ${url}`));

    bus.on("kernel:ready", ({ system }) => {
      log(`[boot] kernel ready. subsystems: ${system.join(", ")}`);
      log("------------------------------------------------");
      log("Double-click a desktop icon, or use Start, to launch an app.");
    });

    const kernel = new Kernel();
    window.kernel = kernel;
    kernel.boot();

    /**
     * Exercises VFS purely through events (vfs:listDir / vfs:readFile),
     * the same way the Explorer app would. Only runs in debug mode —
     * it's a development self-test, not a user-facing feature.
     */
    function runVfsSelfTest() {
      const reqList = `selftest-list-${Math.random().toString(36).slice(2)}`;
      bus.once("vfs:dirListed", (payload) => {
        if (payload.requestId !== reqList) return;
        const names = payload.children.map((c) => c.name).join(", ");
        log(`[vfs] listDir("My Computer") -> [${names}]`);
      });
      bus.emit("vfs:listDir", { path: "My Computer", requestId: reqList });

      const reqRead = `selftest-read-${Math.random().toString(36).slice(2)}`;
      bus.once("vfs:fileRead", (payload) => {
        if (payload.requestId !== reqRead) return;
        const preview = (payload.file?.content || "").split("\n")[0];
        log(`[vfs] readFile("Read Me.txt") -> "${preview}..."`);
      });
      bus.emit("vfs:readFile", {
        path: "My Computer/Documents/Read Me.txt",
        requestId: reqRead
      });
    }
  });
})();
