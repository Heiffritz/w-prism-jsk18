/**
 * startMenuEngine.js
 * ------------------------------------------------------------------
 * The Start Menu: a two-panel popup, matching the real XP Luna
 * layout (left: pinned/all-apps list, right: a narrower "places"
 * panel of system shortcuts), opened/closed via the taskbar's Start
 * button.
 *
 * LEFT PANEL: every registered app, pulled reactively from
 * ProcessManager's roster (process:roster), same pattern as before.
 *
 * RIGHT PANEL: a small fixed set of "system shortcut" entries (My
 * Documents, My Pictures, My Computer, Control Panel). These are NOT
 * separate real apps — each one maps onto an EXISTING app via
 * process:spawn, since this project doesn't have a dedicated
 * Explorer/file-browser app. This keeps every shortcut genuinely
 * functional rather than a decorative dead link:
 *   - My Pictures    -> spawns "gallery"
 *   - My Documents    -> spawns "certificates" (our only document app)
 *   - Control Panel   -> spawns "settings" (Phase: Settings app)
 *   - My Computer     -> spawns "certificates" too (closest existing
 *                         thing to a file browser; a dedicated
 *                         Explorer app is out of scope here)
 *
 * StartMenuEngine never touches WindowManager/ProcessManager
 * directly — same architecture rule as every runtime module.
 * ------------------------------------------------------------------
 */

class StartMenuEngine {
  constructor(eventBus) {
    this.bus = eventBus;

    this.menuEl = null;
    this.appListEl = null;
    this._isOpen = false;

    // Map<appId, entryElement>
    this._entryEls = new Map();

    this._buildMenu();
    this._bindEvents();
  }

  /** ---------------------------------------------------------------
   * Construction
   * ------------------------------------------------------------- */

  _buildMenu() {
    const menu = document.createElement("div");
    menu.id = "start-menu";
    menu.className = "prism-start-menu";
    menu.style.display = "none";

    menu.innerHTML = `
      <div class="prism-start-menu-header">
        <div class="prism-start-menu-avatar">★</div>
        <div class="prism-start-menu-username">Guest</div>
      </div>
      <div class="prism-start-menu-body">
        <div class="prism-start-menu-panel-left">
          <div class="prism-start-menu-list"></div>
        </div>
        <div class="prism-start-menu-panel-right">
          <div class="prism-start-menu-places"></div>
          <div class="prism-start-menu-places-divider"></div>
          <div class="prism-start-menu-places prism-start-menu-places-bottom"></div>
        </div>
      </div>
      <div class="prism-start-menu-footer">
        <button type="button" class="prism-start-menu-footer-btn" data-action="logoff">Log Off</button>
        <button type="button" class="prism-start-menu-footer-btn prism-start-menu-footer-btn-danger" data-action="turnoff">Turn Off</button>
      </div>
    `;

    document.body.appendChild(menu);

    this.menuEl = menu;
    this.appListEl = menu.querySelector(".prism-start-menu-list");

    this._buildPlacesPanel(menu);
    this._bindFooterButtons(menu);
  }

  /**
   * The right-hand "places" panel — fixed shortcut entries that map
   * onto existing apps (see header note for the mapping rationale).
   */
  _buildPlacesPanel(menu) {
    const PLACES = [
      { label: "My Documents", glyph: "📄", appId: "certificates" },
      { label: "My Pictures", glyph: "🖼", appId: "gallery" },
      { label: "My Computer", glyph: "🖥", appId: "certificates" }
    ];
    const BOTTOM_PLACES = [
      { label: "Control Panel", glyph: "⚙", appId: "settings" },
      { label: "Help and Support", glyph: "?", appId: null }
    ];

    const topPanel = menu.querySelector(".prism-start-menu-places");
    PLACES.forEach((place) => topPanel.appendChild(this._buildPlaceEntry(place)));

    const bottomPanel = menu.querySelector(".prism-start-menu-places-bottom");
    BOTTOM_PLACES.forEach((place) => bottomPanel.appendChild(this._buildPlaceEntry(place)));
  }

  _buildPlaceEntry(place) {
    const entry = document.createElement("div");
    entry.className = "prism-start-menu-place";
    if (!place.appId) entry.classList.add("disabled");

    const glyph = document.createElement("span");
    glyph.className = "prism-start-menu-place-glyph";
    glyph.textContent = place.glyph;

    const label = document.createElement("span");
    label.className = "prism-start-menu-place-label";
    label.textContent = place.label;

    entry.appendChild(glyph);
    entry.appendChild(label);

    if (place.appId) {
      entry.addEventListener("click", () => {
        this.bus.emit("process:spawn", { appId: place.appId });
        this.close();
      });
    }

    return entry;
  }

  _bindFooterButtons(menu) {
    // "Log Off" / "Turn Off" are deliberately non-destructive no-ops
    // here — this is a portfolio simulation, not a real session
    // manager, and there is nothing meaningful to log off FROM or
    // shut down. They close the menu so they still feel responsive
    // rather than silently doing nothing.
    menu.querySelectorAll(".prism-start-menu-footer-btn").forEach((btn) => {
      btn.addEventListener("click", () => this.close());
    });
  }

  /** ---------------------------------------------------------------
   * Events
   * ------------------------------------------------------------- */

  _bindEvents() {
    this.bus.on("startmenu:toggle", () => this.toggle());
    this.bus.on("startmenu:open", () => this.open());
    this.bus.on("startmenu:close", () => this.close());

    this.bus.on("process:roster", ({ apps }) => {
      apps.forEach((appDef) => {
        if (!this._entryEls.has(appDef.appId)) this._renderEntry(appDef);
      });
    });
    this.bus.on("process:appRegistered", () => {
      this.bus.emit("process:requestRoster", {});
    });
    this.bus.emit("process:requestRoster", {});

    // Outside-click and Escape dismissal. Capture phase so this runs
    // before other click handlers (e.g. desktop deselect) and doesn't
    // race with the Start button's own click toggling it back open.
    document.addEventListener(
      "mousedown",
      (e) => {
        if (!this._isOpen) return;
        const startBtn = document.getElementById("start-button");
        if (this.menuEl.contains(e.target)) return;
        if (startBtn && startBtn.contains(e.target)) return; // let the button's own handler manage toggle
        this.close();
      },
      { capture: true }
    );

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this._isOpen) this.close();
    });
  }

  /** ---------------------------------------------------------------
   * Left panel: app entry rendering
   * ------------------------------------------------------------- */

  _renderEntry(appDef) {
    const entry = document.createElement("div");
    entry.className = "prism-start-menu-item";
    entry.dataset.appId = appDef.appId;

    const glyph = document.createElement("div");
    glyph.className = "prism-start-menu-item-glyph";
    glyph.textContent = "▣"; // shown until/unless a real asset resolves

    if (appDef.icon) {
      // Same AssetManager-key resolution pattern as DesktopEngine and
      // WindowManager — never treat appDef.icon as a raw path.
      const requestId = `startMenuIcon-${appDef.appId}-${Math.random().toString(36).slice(2)}`;
      const handler = (payload) => {
        if (payload.requestId !== requestId) return;
        this.bus.off("asset:resolved", handler);
        if (payload.found) {
          glyph.style.backgroundImage = `url(${payload.path})`;
          glyph.textContent = "";
        }
      };
      this.bus.on("asset:resolved", handler);
      this.bus.emit("asset:get", { key: appDef.icon, requestId });
    }

    const label = document.createElement("div");
    label.className = "prism-start-menu-item-label";
    label.textContent = appDef.title || appDef.appId;

    entry.appendChild(glyph);
    entry.appendChild(label);

    entry.addEventListener("click", () => {
      this.bus.emit("process:spawn", { appId: appDef.appId });
      this.close();
    });

    this.appListEl.appendChild(entry);
    this._entryEls.set(appDef.appId, entry);
  }

  /** ---------------------------------------------------------------
   * Open / close / toggle
   * ------------------------------------------------------------- */

  open() {
    this.menuEl.style.display = "flex";
    this._isOpen = true;
    this.bus.emit("startmenu:opened", {});
  }

  close() {
    this.menuEl.style.display = "none";
    this._isOpen = false;
    this.bus.emit("startmenu:closed", {});
  }

  toggle() {
    if (this._isOpen) this.close();
    else this.open();
  }
}

window.StartMenuEngine = StartMenuEngine;
