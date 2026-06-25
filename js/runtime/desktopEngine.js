/**
 * desktopEngine.js
 * ------------------------------------------------------------------
 * Renders the OS "desktop surface": the full-screen background layer
 * that holds desktop icons (one per launchable app) and the
 * wallpaper. This is the first piece of "real" OS UI — previously
 * windows just floated on the bare page background.
 *
 * Responsibilities:
 *   - build the #desktop-surface element (wallpaper + icon grid)
 *   - render one icon per registered app
 *   - double-click an icon -> emit "process:spawn" (DesktopEngine
 *     never calls ProcessManager directly)
 *   - single-click an icon -> select it (visual highlight only)
 *   - right-click the desktop background -> ask ContextMenuEngine
 *     to open a desktop menu (e.g. "Refresh", future "Change wallpaper")
 *   - right-click an icon -> ask ContextMenuEngine to open an
 *     icon-specific menu (e.g. "Open", future "Rename"/"Properties")
 *
 * DesktopEngine does NOT create windows itself and does NOT know
 * what WindowManager is. It only knows about apps (via the
 * "process:appRegistered" roster) and emits process/contextmenu
 * events.
 * ------------------------------------------------------------------
 */

class DesktopEngine {
  constructor(eventBus) {
    this.bus = eventBus;

    this.surfaceEl = null;
    this.iconLayerEl = null;
    this._selectedIconAppId = null;

    // Map<appId, iconElement> for quick lookup/highlighting
    this._iconEls = new Map();

    this._buildSurface();
    this._bindEvents();
  }

  /** ---------------------------------------------------------------
   * Surface construction
   * ------------------------------------------------------------- */

  _buildSurface() {
    const surface = document.createElement("div");
    surface.id = "desktop-surface";
    surface.className = "prism-desktop";

    const iconLayer = document.createElement("div");
    iconLayer.id = "desktop-icon-layer";
    iconLayer.className = "prism-desktop-icons";

    surface.appendChild(iconLayer);

    // The desktop surface must sit BEHIND the window layer that
    // WindowManager created in Phase 2. WindowManager always creates
    // #window-layer as a child of <body>; we insert the desktop
    // surface as the very first child of <body> so it renders below
    // everything else in paint order, then let CSS position both as
    // full-screen fixed layers.
    document.body.insertBefore(surface, document.body.firstChild);

    surface.addEventListener("contextmenu", (e) => {
      // Only trigger the desktop's own menu when the click lands on
      // empty desktop space, not bubbled up from an icon (icons stop
      // propagation themselves — see _renderIcon).
      e.preventDefault();
      this._deselectIcon();
      this.bus.emit("contextmenu:open", {
        x: e.clientX,
        y: e.clientY,
        items: [
          { label: "Refresh", action: "desktop:refresh" },
          { separator: true },
          { label: "Arrange Icons", action: "desktop:arrangeIcons", disabled: true },
          { label: "Change Wallpaper", action: "desktop:changeWallpaper", disabled: true }
        ],
        context: { source: "desktop" }
      });
    });

    // Click empty desktop space -> deselect any selected icon,
    // matching real OS desktop behavior.
    surface.addEventListener("mousedown", (e) => {
      if (e.target === surface || e.target === iconLayer) {
        this._deselectIcon();
      }
    });

    this.surfaceEl = surface;
    this.iconLayerEl = iconLayer;
  }

  /** ---------------------------------------------------------------
   * Events
   * ------------------------------------------------------------- */

  _bindEvents() {
    // Whenever an app is registered (Kernel loading app modules),
    // re-pull the full roster so we always render icons from
    // complete appDef objects (title, icon, etc) rather than the
    // bare appId carried by "process:appRegistered".
    this.bus.on("process:appRegistered", () => {
      this.bus.emit("process:requestRoster", {});
    });

    this.bus.on("process:roster", ({ apps }) => {
      apps.forEach((appDef) => {
        if (!this._iconEls.has(appDef.appId)) this._renderIcon(appDef);
      });
    });

    // Pull the current roster once on construction too, in case
    // some apps were already registered before DesktopEngine booted.
    this.bus.emit("process:requestRoster", {});

    // Desktop's own context menu actions
    this.bus.on("contextmenu:action", ({ action, context }) => {
      if (!context || (context.source !== "desktop" && context.source !== "desktopIcon")) return;

      if (action === "desktop:refresh") {
        this._refreshIcons();
      }
      if (action === "desktopIcon:open" && context.appId) {
        this.bus.emit("process:spawn", { appId: context.appId });
      }
    });
  }

  /** ---------------------------------------------------------------
   * Icon rendering
   * ------------------------------------------------------------- */

  _renderIcon(appDef) {
    const icon = document.createElement("div");
    icon.className = "prism-desktop-icon";
    icon.dataset.appId = appDef.appId;
    icon.tabIndex = 0;

    const img = document.createElement("div");
    img.className = "prism-desktop-icon-glyph";
    img.textContent = "▣"; // shown until/unless a real asset resolves

    if (appDef.icon) {
      // appDef.icon is an AssetManager KEY (e.g. "icon.about"), not a
      // raw path. Resolve it via the asset:get/asset:resolved
      // request-response pair — DesktopEngine never holds a direct
      // reference to AssetManager, same rule as every other module.
      const requestId = `desktopIcon-${appDef.appId}-${Math.random().toString(36).slice(2)}`;
      const handler = (payload) => {
        if (payload.requestId !== requestId) return;
        this.bus.off("asset:resolved", handler);
        // Only swap to the real image if AssetManager actually found
        // a registered path for this key. Without this check, a
        // missing/unregistered icon key would resolve to
        // AssetManager's placeholder (a 1x1 transparent pixel),
        // leaving the icon glyph blank instead of showing our own
        // "▣" fallback character.
        if (payload.found) {
          img.style.backgroundImage = `url(${payload.path})`;
          img.textContent = "";
        }
      };
      this.bus.on("asset:resolved", handler);
      this.bus.emit("asset:get", { key: appDef.icon, requestId });
    }

    const label = document.createElement("div");
    label.className = "prism-desktop-icon-label";
    label.textContent = appDef.title || appDef.appId;

    icon.appendChild(img);
    icon.appendChild(label);

    icon.addEventListener("mousedown", (e) => {
      e.stopPropagation(); // don't trigger surface-level deselect
      this._selectIcon(appDef.appId);
    });

    icon.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      this.bus.emit("process:spawn", { appId: appDef.appId });
    });

    icon.addEventListener("keydown", (e) => {
      if (e.key === "Enter") this.bus.emit("process:spawn", { appId: appDef.appId });
    });

    icon.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this._selectIcon(appDef.appId);
      this.bus.emit("contextmenu:open", {
        x: e.clientX,
        y: e.clientY,
        items: [
          { label: "Open", action: "desktopIcon:open" },
          { separator: true },
          { label: "Rename", action: "desktopIcon:rename", disabled: true },
          { label: "Properties", action: "desktopIcon:properties", disabled: true }
        ],
        context: { source: "desktopIcon", appId: appDef.appId }
      });
    });

    this.iconLayerEl.appendChild(icon);
    this._iconEls.set(appDef.appId, icon);
  }

  _selectIcon(appId) {
    this._deselectIcon();
    const el = this._iconEls.get(appId);
    if (el) {
      el.classList.add("selected");
      this._selectedIconAppId = appId;
    }
  }

  _deselectIcon() {
    if (this._selectedIconAppId) {
      const el = this._iconEls.get(this._selectedIconAppId);
      if (el) el.classList.remove("selected");
      this._selectedIconAppId = null;
    }
  }

  _refreshIcons() {
    // A trivial "refresh" effect — real OSes re-read the file system;
    // we just briefly flash the icon layer's opacity as feedback.
    this.iconLayerEl.style.transition = "opacity 0.1s";
    this.iconLayerEl.style.opacity = "0.4";
    setTimeout(() => {
      this.iconLayerEl.style.opacity = "1";
    }, 100);
  }
}

window.DesktopEngine = DesktopEngine;
