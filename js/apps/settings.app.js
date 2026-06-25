/**
 * settings.app.js
 * ------------------------------------------------------------------
 * The "Settings" app (the OS's Control Panel equivalent) — lets the
 * person switch the active theme (Luna / Aero) and pick a desktop
 * wallpaper preset. Same registration/factory/window pattern as
 * every other app (see about.app.js for the full architecture note).
 *
 * Theme and wallpaper changes go through ThemeManager exclusively
 * via events ("theme:set", "wallpaper:set") — this app never touches
 * ThemeManager directly, same architecture rule as everywhere else.
 * Both choices are picked up by session.js automatically (it already
 * listens for "theme:applied"/persists the theme; wallpaper
 * persistence is added alongside it in this same change).
 * ------------------------------------------------------------------ */

(function registerSettingsApp() {
  const APP_ID = "settings";

  const THEME_OPTIONS = [
    { value: "luna", label: "Windows XP (Luna)", swatch: "linear-gradient(135deg, #0a59f7, #3fae3f)" },
    { value: "aero", label: "Windows Vista (Aero)", swatch: "linear-gradient(135deg, #a0c8f5, #5a9fd4)" }
  ];

  const WALLPAPER_OPTIONS = [
    { value: "theme-default", label: "Theme Default", swatch: null },
    { value: "bliss-hills", label: "Green Hills", swatch: "linear-gradient(to bottom, #6fb0ec 0%, #bcdff5 55%, #4a8c2a 56%, #3a7a1a 100%)" },
    { value: "sunset", label: "Sunset", swatch: "linear-gradient(to bottom, #2a1a4a, #d4682a, #f4a23a)" },
    { value: "midnight", label: "Midnight", swatch: "radial-gradient(circle, #1a2a4a, #000008)" },
    { value: "forest", label: "Forest", swatch: "linear-gradient(to bottom, #1a3a1a, #2a5a2a)" },
    // Image-based wallpapers (suggestion #14). assetKey points at a
    // real AssetManager-registered key — the actual .png files are a
    // deployment-time content task (drop them into assets/wallpapers/),
    // same as app icons and gallery photos elsewhere in this project.
    // Swatch previews resolve the real image via AssetManager at
    // render time (see renderSettings below); until a file exists at
    // that path, the swatch shows a neutral "no preview" pattern
    // rather than a broken image, same graceful-degradation style as
    // the Gallery app.
    { value: "bliss", label: "Bliss", assetKey: "wallpaper.bliss" },
    { value: "woe", label: "Woe", assetKey: "wallpaper.woe" },
    { value: "anguish", label: "Anguish", assetKey: "wallpaper.anguish" },
    { value: "error", label: "Error", assetKey: "wallpaper.error" },
    { value: "wonder", label: "Wonder", assetKey: "wallpaper.wonder" },
    { value: "absurd", label: "Absurd", assetKey: "wallpaper.absurd" },
    { value: "relief", label: "Relief", assetKey: "wallpaper.relief" },
    { value: "window", label: "Window", assetKey: "wallpaper.window" },
    { value: "hope", label: "Hope", assetKey: "wallpaper.hope" },
    { value: "prism", label: "Prism", assetKey: "wallpaper.prism" }
  ];

  window.eventBus.on("kernel:ready", () => {
    window.eventBus.emit("process:registerApp", {
      appId: APP_ID,
      title: "Settings",
      icon: "icon.settings",
      singleInstance: true,
      factory: settingsAppFactory
    });
  });

  function settingsAppFactory(ctx) {
    const unsubscribe = ctx.on("window:created", (payload) => {
      if (payload.pid !== ctx.pid) return;
      unsubscribe();
      ctx.setWindowId(payload.windowId);
      renderSettings(payload.contentEl, ctx);
    });

    ctx.emit("window:create", {
      title: "Settings",
      icon: "icon.settings",
      width: 440,
      height: 420
    });
  }

  function renderSettings(contentEl, ctx) {
    const themeSwatchesHtml = THEME_OPTIONS.map((opt) => buildSwatchHtml(opt, "theme")).join("");
    const wallpaperSwatchesHtml = WALLPAPER_OPTIONS.map((opt) => buildSwatchHtml(opt, "wallpaper")).join("");

    contentEl.innerHTML = `
      <div class="app-settings">
        <div class="app-settings-section">
          <div class="app-settings-section-title">Theme</div>
          <div class="app-settings-swatch-grid" data-group="theme">${themeSwatchesHtml}</div>
        </div>
        <div class="app-settings-section">
          <div class="app-settings-section-title">Desktop Wallpaper</div>
          <div class="app-settings-swatch-grid" data-group="wallpaper">${wallpaperSwatchesHtml}</div>
        </div>
        <div class="app-settings-section">
          <div class="app-settings-section-title">Notifications</div>
          <p class="app-settings-text">
            Re-show the welcome message that appears the first time
            someone visits this portfolio.
          </p>
          <button type="button" class="app-settings-action-btn" data-action="show-welcome">
            Show Welcome Message
          </button>
        </div>
        <div class="app-settings-section">
          <div class="app-settings-section-title">About</div>
          <p class="app-settings-text">
            <strong>Windows Prism JSK</strong> is a portfolio built as
            a simulated operating system, running entirely in your
            browser — a custom kernel, event bus, process manager,
            window manager, and a small set of "apps" you can launch
            like a real desktop. Every visual detail, from the
            titlebar gradients to the Start menu, is hand-built in
            plain HTML, CSS, and JavaScript.
          </p>
          <p class="app-settings-text">
            Built and designed as a portfolio centerpiece, intended to
            demonstrate both software architecture and visual
            attention to detail.
          </p>
        </div>
        <div class="app-settings-section">
          <div class="app-settings-section-title">Manual</div>
          <ul class="app-settings-manual-list">
            <li>Double-click a desktop icon, or use the <strong>start</strong> menu, to open an app.</li>
            <li>Drag a window by its titlebar to move it.</li>
            <li>Use the <strong>_</strong> / <strong>□</strong> / <strong>×</strong> buttons (or double-click the titlebar) to minimize, maximize, or close a window.</li>
            <li>Right-click the desktop, an icon, or a taskbar button for more options.</li>
            <li>Click a taskbar button to focus or minimize that app's window.</li>
            <li>Your open windows, theme, and wallpaper are remembered the next time you visit.</li>
          </ul>
        </div>
        <div class="app-settings-note">
          Changes apply immediately and are remembered the next time you visit.
        </div>
      </div>
    `;

    contentEl.querySelector('[data-action="show-welcome"]').addEventListener("click", () => {
      ctx.emit("welcome:show", {});
    });

    // Fetch current selections so the right swatch starts marked
    // active, rather than always defaulting visually to the first
    // option regardless of what's actually applied.
    const themeReqId = `settings-theme-${Math.random().toString(36).slice(2)}`;
    ctx.on("theme:current", (payload) => {
      if (payload.requestId !== themeReqId) return;
      markActive(contentEl, "theme", payload.theme);
    });
    ctx.emit("theme:get", { requestId: themeReqId });

    const wallpaperReqId = `settings-wallpaper-${Math.random().toString(36).slice(2)}`;
    ctx.on("wallpaper:current", (payload) => {
      if (payload.requestId !== wallpaperReqId) return;
      markActive(contentEl, "wallpaper", payload.wallpaper);
    });
    ctx.emit("wallpaper:get", { requestId: wallpaperReqId });

    contentEl.querySelectorAll(".app-settings-swatch").forEach((swatchEl) => {
      swatchEl.addEventListener("click", () => {
        const group = swatchEl.dataset.group;
        const value = swatchEl.dataset.value;

        if (group === "theme") {
          ctx.emit("theme:set", { theme: value });
        } else if (group === "wallpaper") {
          ctx.emit("wallpaper:set", { wallpaper: value });
        }
        markActive(contentEl, group, value);
      });
    });

    // Resolve real preview images for the image-based wallpaper
    // options (suggestion #14). Same asset:get/asset:resolved
    // request-response pattern used everywhere else in this OS —
    // this app never holds a direct AssetManager reference. If a
    // file doesn't exist yet at the resolved path, the swatch's
    // background-image simply 404s and the underlying checkered
    // "no preview" pattern (already set as a fallback by
    // buildSwatchHtml) remains visible underneath it.
    WALLPAPER_OPTIONS.forEach((opt) => {
      if (!opt.assetKey) return;
      const swatchPreviewEl = contentEl.querySelector(
        `.app-settings-swatch[data-group="wallpaper"][data-value="${opt.value}"] .app-settings-swatch-preview`
      );
      if (!swatchPreviewEl) return;

      const requestId = `settings-wallpaper-preview-${opt.value}-${Math.random().toString(36).slice(2)}`;
      const handler = (payload) => {
        if (payload.requestId !== requestId) return;
        unsub();
        if (payload.found) {
          swatchPreviewEl.style.backgroundImage = `url("${payload.path}")`;
          swatchPreviewEl.style.backgroundSize = "cover";
          swatchPreviewEl.style.backgroundPosition = "center";
        }
      };
      const unsub = ctx.on("asset:resolved", handler);
      ctx.emit("asset:get", { key: opt.assetKey, requestId });
    });
  }

  function buildSwatchHtml(opt, group) {
    const swatchStyle = opt.swatch
      ? `style="background: ${opt.swatch};"`
      : `style="background: repeating-linear-gradient(45deg, #ddd, #ddd 6px, #eee 6px, #eee 12px);"`;
    return `
      <div class="app-settings-swatch" data-group="${group}" data-value="${opt.value}">
        <div class="app-settings-swatch-preview" ${swatchStyle}></div>
        <div class="app-settings-swatch-label">${escapeHtml(opt.label)}</div>
      </div>
    `;
  }

  function markActive(contentEl, group, value) {
    contentEl.querySelectorAll(`.app-settings-swatch[data-group="${group}"]`).forEach((el) => {
      el.classList.toggle("active", el.dataset.value === value);
    });
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }
})();
