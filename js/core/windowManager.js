/**
 * windowManager.js
 * ------------------------------------------------------------------
 * The UI VIRTUALIZATION LAYER of the OS.
 *
 * HARD RULE: WindowManager is the ONLY module in the entire system
 * allowed to create, move, resize, focus, or destroy window DOM
 * elements. Apps never touch the DOM for their window chrome — they
 * ask WindowManager (via EventBus) for a window, then render their
 * own content into the content element it hands back.
 *
 * Responsibilities:
 *   - createWindow(options)  -> builds title bar + content area, mounts
 *                               it to the desktop layer, registers it
 *   - closeWindow(windowId)  -> removes DOM, cleans registry, emits event
 *   - focusWindow(windowId)  -> raises z-index, marks active/inactive
 *   - z-index stacking       -> internal counter, always increasing
 *   - drag movement          -> mousedown on titlebar -> track -> release
 *
 * WindowManager does NOT know what a "process" or an "app" is. It
 * only knows windowId, title, icon, and a content element. The link
 * between a process (PID) and a window (windowId) is made by
 * ProcessManager listening for "window:created" and storing the
 * windowId on its process record (see process:linkWindow below).
 *
 * PHASE 2 STATE: there is no desktop/taskbar/start menu surface yet
 * (Phase 3). Windows mount directly into a `#window-layer` container
 * that this module creates lazily on first use.
 * ------------------------------------------------------------------
 */

class WindowManager {
  constructor(eventBus) {
    this.bus = eventBus;

    // Map<windowId, windowRecord>
    // windowRecord = { id, el, titleBarEl, contentEl, pid, title, icon,
    //                  x, y, width, height, zIndex, state, minimized }
    this.windows = new Map();

    this._windowIdCounter = 1;
    this._zIndexCounter = 10; // start above the (future) desktop layer
    this._activeWindowId = null;

    // Reserved space at the bottom of the screen for the taskbar
    // (Phase 3). Kept as a plain constant rather than reading the
    // --taskbar-height CSS variable, so WindowManager stays decoupled
    // from TaskbarEngine's specific DOM/CSS implementation — if the
    // taskbar height ever changes, update this constant and the CSS
    // variable together.
    this._taskbarHeight = 40;

    // Drag state — only ever describes the window currently being
    // dragged, never persisted per-window.
    this._dragState = null;

    this._ensureWindowLayer();
    this._bindGlobalDOMListeners();
    this._bindEvents();
  }

  /** ---------------------------------------------------------------
   * Setup
   * ------------------------------------------------------------- */

  /**
   * Lazily creates the container all windows mount into. In Phase 3
   * this becomes a child of the desktop surface; for now it's a
   * direct child of <body>.
   */
  _ensureWindowLayer() {
    let layer = document.getElementById("window-layer");
    if (!layer) {
      layer = document.createElement("div");
      layer.id = "window-layer";
      layer.style.position = "fixed";
      layer.style.top = "0";
      layer.style.left = "0";
      layer.style.width = "100%";
      layer.style.height = "100%";
      layer.style.pointerEvents = "none"; // children re-enable per-window
      document.body.appendChild(layer);
    }
    this.layerEl = layer;
  }

  /**
   * Document-level mousemove/mouseup listeners for dragging. These
   * live on `document` (not the window element) so that fast mouse
   * movement that briefly leaves the titlebar doesn't drop the drag.
   */
  _bindGlobalDOMListeners() {
    document.addEventListener("mousemove", (e) => this._onDragMove(e));
    document.addEventListener("mouseup", () => this._onDragEnd());
  }

  /**
   * WindowManager is reachable through events, same as every other
   * subsystem, so apps/runtime UI never need a direct reference to it.
   */
  _bindEvents() {
    this.bus.on("window:create", (options) => {
      this.createWindow(options);
    });

    this.bus.on("window:close", ({ windowId } = {}) => {
      this.closeWindow(windowId);
    });

    this.bus.on("window:focus", ({ windowId } = {}) => {
      this.focusWindow(windowId);
    });

    this.bus.on("window:minimize", ({ windowId } = {}) => {
      this.minimizeWindow(windowId);
    });

    this.bus.on("window:restore", ({ windowId } = {}) => {
      this.restoreWindow(windowId);
    });

    // Suggestion #1: maximize support, same dual-access pattern
    // (direct method + event) as every other window action.
    this.bus.on("window:maximize", ({ windowId } = {}) => {
      this.maximizeWindow(windowId);
    });
    this.bus.on("window:toggleMaximize", ({ windowId } = {}) => {
      this.toggleMaximize(windowId);
    });

    // PHASE 9: Session asks WindowManager to reposition/resize a
    // just-created window to match saved session data. Distinct from
    // "window:restore" (which un-minimizes) — this only repositions
    // geometry and never changes minimized/normal state.
    this.bus.on("window:restoreGeometry", ({ windowId, x, y, width, height } = {}) => {
      this.setWindowGeometry(windowId, { x, y, width, height });
    });

    // ProcessManager kills a process -> any window it owns must close.
    this.bus.on("process:killed", ({ windowId }) => {
      if (windowId) this.closeWindow(windowId);
    });

    // Phase 1's process:focusRequested (single-instance re-focus) ->
    // translate pid to windowId and focus it.
    this.bus.on("process:focusRequested", ({ pid }) => {
      const record = [...this.windows.values()].find((w) => w.pid === pid);
      if (record) this.focusWindow(record.id);
    });
  }

  /** ---------------------------------------------------------------
   * Core lifecycle: create / close / focus
   * ------------------------------------------------------------- */

  /**
   * Create a new window.
   * @param {Object} options
   * @param {number} [options.pid] - owning process id (optional, but
   *        every app-spawned window should pass this so ProcessManager
   *        and TaskbarEngine can map window <-> process)
   * @param {string} [options.title]
   * @param {string} [options.icon]
   * @param {number} [options.width=480]
   * @param {number} [options.height=320]
   * @param {number} [options.x] - defaults to a cascading offset
   * @param {number} [options.y]
   * @param {boolean} [options.resizable=true]
   * @returns {string} windowId
   */
  createWindow(options = {}) {
    const id = `win-${this._windowIdCounter++}`;

    const width = options.width || 480;
    const height = options.height || 320;
    const { x, y } = this._computeSpawnPosition(width, height, options);

    const el = document.createElement("div");
    el.className = "prism-window";
    el.dataset.windowId = id;
    el.style.position = "absolute";
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.width = `${width}px`;
    el.style.height = `${height}px`;
    el.style.pointerEvents = "auto";

    const titleBarEl = this._buildTitleBar(id, options.title || "Untitled", options.icon);
    const contentEl = document.createElement("div");
    contentEl.className = "prism-window-content";
    contentEl.style.width = "100%";
    contentEl.style.height = "calc(100% - 32px)"; // 32px reserved for titlebar
    contentEl.style.overflow = "auto";

    el.appendChild(titleBarEl);
    el.appendChild(contentEl);
    this.layerEl.appendChild(el);

    const record = {
      id,
      el,
      titleBarEl,
      contentEl,
      pid: options.pid ?? null,
      title: options.title || "Untitled",
      icon: options.icon || null,
      x, y, width, height,
      zIndex: 0,
      state: "normal", // normal | minimized | maximized
      resizable: options.resizable !== false
    };

    this.windows.set(id, record);

    // Clicking anywhere on the window (not just the titlebar) brings
    // it to front, matching real OS window-manager behavior.
    el.addEventListener("mousedown", () => this.focusWindow(id));

    this.focusWindow(id);

    // Animate the window's appearance (Phase 8). animations.js owns
    // no DOM itself — it only applies a transition to the element
    // WindowManager already created and mounted. If PrismAnimations
    // isn't loaded for any reason, the window simply appears
    // instantly with no animation rather than throwing.
    if (window.PrismAnimations) {
      window.PrismAnimations.animateOpen(el);
    }

    this.bus.emit("window:created", {
      windowId: id,
      pid: record.pid,
      contentEl, // apps render their UI into this element
      title: record.title
    });

    return id;
  }

  /**
   * Stagger new windows diagonally like real desktop OSes, wrapping
   * back to a top-left-ish origin if they'd run off-screen.
   */
  _computeSpawnPosition(width, height, options) {
    if (typeof options.x === "number" && typeof options.y === "number") {
      return { x: options.x, y: options.y };
    }
    const openCount = this.windows.size;
    const stepX = 32;
    const stepY = 32;
    const originX = 80;
    const originY = 60;

    const maxX = Math.max(window.innerWidth - width - 40, originX);
    const maxY = Math.max(window.innerHeight - height - 40 - this._taskbarHeight, originY);

    let x = originX + (openCount * stepX) % Math.max(maxX - originX, stepX);
    let y = originY + (openCount * stepY) % Math.max(maxY - originY, stepY);

    return { x, y };
  }

  _buildTitleBar(windowId, title, icon) {
    const bar = document.createElement("div");
    bar.className = "prism-window-titlebar";
    bar.style.height = "32px";
    bar.style.width = "100%";
    bar.style.display = "flex";
    bar.style.alignItems = "center";
    bar.style.justifyContent = "space-between";
    bar.style.cursor = "default";
    bar.style.userSelect = "none";
    bar.style.boxSizing = "border-box";

    const titleWrap = document.createElement("div");
    titleWrap.className = "prism-window-titletext";
    titleWrap.style.display = "flex";
    titleWrap.style.alignItems = "center";
    titleWrap.style.gap = "6px";
    titleWrap.style.overflow = "hidden";
    titleWrap.style.whiteSpace = "nowrap";
    titleWrap.style.flex = "1";
    titleWrap.style.padding = "0 8px";

    if (icon) {
      const iconEl = document.createElement("img");
      iconEl.style.width = "16px";
      iconEl.style.height = "16px";
      iconEl.draggable = false;
      titleWrap.appendChild(iconEl);

      // `icon` here is an AssetManager KEY (e.g. "icon.about"), not a
      // raw path — WindowManager resolves it the same way every other
      // UI module does, via the asset:get/asset:resolved request-
      // response pair, so it never needs a direct reference to
      // AssetManager (same architecture rule as everywhere else).
      const requestId = `titlebarIcon-${this._windowIdCounter}-${Math.random().toString(36).slice(2)}`;
      const handler = (payload) => {
        if (payload.requestId !== requestId) return;
        this.bus.off("asset:resolved", handler);
        iconEl.src = payload.path;
      };
      this.bus.on("asset:resolved", handler);
      this.bus.emit("asset:get", { key: icon, requestId });
    }

    const titleText = document.createElement("span");
    titleText.textContent = title;
    titleWrap.appendChild(titleText);

    const controls = document.createElement("div");
    controls.className = "prism-window-controls";
    controls.style.display = "flex";

    const minimizeBtn = this._buildControlButton("_", () => {
      this.minimizeWindow(windowId);
    });
    const maximizeBtn = this._buildControlButton("□", () => {
      this.toggleMaximize(windowId);
    });
    const closeBtn = this._buildControlButton("×", () => {
      this.closeWindow(windowId);
    });

    controls.appendChild(minimizeBtn);
    controls.appendChild(maximizeBtn);
    controls.appendChild(closeBtn);

    bar.appendChild(titleWrap);
    bar.appendChild(controls);

    // Drag only initiates from the titlebar, and not from the
    // control buttons themselves (handled via stopPropagation there).
    bar.addEventListener("mousedown", (e) => this._onDragStart(e, windowId));

    // Double-clicking the titlebar toggles maximize, matching the
    // real OS convention (and the maximize button itself).
    bar.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      this.toggleMaximize(windowId);
    });

    return bar;
  }

  _buildControlButton(label, onClick) {
    const btn = document.createElement("button");
    btn.textContent = label;
    btn.className = "prism-window-btn";
    // No inline cosmetic styles here — all visual styling (size,
    // colors, gradients, hover/active states) is owned by styles.css
    // via theme CSS variables, so a theme switch can restyle these
    // buttons without WindowManager needing to know or care.
    btn.style.cursor = "pointer";
    btn.style.font = "inherit";
    btn.addEventListener("mousedown", (e) => e.stopPropagation()); // don't start a drag
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      onClick();
    });
    return btn;
  }

  /**
   * Close a window: remove its DOM, drop it from the registry, and
   * tell the rest of the OS it's gone. Does NOT kill the owning
   * process — ProcessManager decides independently whether closing
   * a window should also kill its process (apps may choose either).
   * We emit window:closed with the pid so ProcessManager can react
   * if it wants to.
   */
  closeWindow(windowId) {
    const record = this.windows.get(windowId);
    if (!record) return false;

    // Remove from the registry immediately so the window is
    // considered "gone" from the OS's perspective right away (no
    // double-close races, taskbar/process bookkeeping updates
    // instantly) — only the VISUAL removal of the DOM element is
    // deferred to let the close animation play first.
    this.windows.delete(windowId);

    if (this._activeWindowId === windowId) {
      this._activeWindowId = null;
      // Auto-focus the next highest window, like a real WM would.
      const next = [...this.windows.values()].sort((a, b) => b.zIndex - a.zIndex)[0];
      if (next) this.focusWindow(next.id);
    }

    const removeElement = () => record.el.remove();
    if (window.PrismAnimations) {
      window.PrismAnimations.animateClose(record.el, removeElement);
    } else {
      removeElement();
    }

    this.bus.emit("window:closed", { windowId, pid: record.pid });
    return true;
  }

  /**
   * Bring a window to the front and mark it active. All other
   * windows are marked inactive (visually handled via CSS class;
   * WindowManager just toggles the class, theming lives in styles.css).
   */
  focusWindow(windowId) {
    const record = this.windows.get(windowId);
    if (!record) return false;

    if (record.state === "minimized") {
      // Focusing a minimized window implicitly restores it.
      this.restoreWindow(windowId);
      return true;
    }

    record.zIndex = ++this._zIndexCounter;
    record.el.style.zIndex = String(record.zIndex);

    if (this._activeWindowId && this._activeWindowId !== windowId) {
      const prev = this.windows.get(this._activeWindowId);
      if (prev) prev.el.classList.remove("active");
    }

    record.el.classList.add("active");
    this._activeWindowId = windowId;

    this.bus.emit("window:focused", { windowId, pid: record.pid });
    return true;
  }

  minimizeWindow(windowId) {
    const record = this.windows.get(windowId);
    if (!record) return false;
    // Guard against both the already-finished state AND the
    // in-flight animation window — record.state only flips to
    // "minimized" once the animation completes (see finishMinimize
    // below), so a transient flag is needed to catch a second
    // minimize click arriving while the first animation is still
    // playing; without it, animateMinimize could be triggered twice
    // on the same element.
    if (record.state === "minimized" || record._minimizing) return true;

    // Remember whether this window was maximized BEFORE minimizing,
    // so restoreWindow() below knows whether to bring it back
    // maximized or to its normal geometry. Without this, minimizing
    // a maximized window and then restoring it would silently lose
    // the maximized state (and leave the maximized 100%-width inline
    // styles stuck in place even though state said "normal").
    record._wasMaximizedBeforeMinimize = record.state === "maximized";

    if (this._activeWindowId === windowId) {
      this._activeWindowId = null;
      const next = [...this.windows.values()]
        .filter((w) => w.id !== windowId && w.state !== "minimized")
        .sort((a, b) => b.zIndex - a.zIndex)[0];
      if (next) this.focusWindow(next.id);
    }

    record._minimizing = true;
    const finishMinimize = () => {
      record.state = "minimized";
      record._minimizing = false;
      record.el.style.display = "none";
    };

    if (window.PrismAnimations) {
      window.PrismAnimations.animateMinimize(record.el, finishMinimize);
    } else {
      finishMinimize();
    }

    this.bus.emit("window:minimized", { windowId, pid: record.pid });
    return true;
  }

  restoreWindow(windowId) {
    const record = this.windows.get(windowId);
    if (!record) return false;
    if (record.state === "normal" && !record._minimizing) return true; // already visible, no-op

    record._minimizing = false; // cancel any in-flight minimize guard if restore interrupts it
    record.el.style.display = "block";

    if (record._wasMaximizedBeforeMinimize) {
      // Bring it back maximized rather than to "normal" — the
      // maximized inline styles (width/height/left/top) were never
      // removed while minimized, so they're already correct; just
      // restore the state label and class.
      record._wasMaximizedBeforeMinimize = false;
      record.state = "maximized";
      record.el.classList.add("maximized");
    } else {
      record.state = "normal";
    }

    this.focusWindow(windowId);

    if (window.PrismAnimations) {
      window.PrismAnimations.animateRestore(record.el);
    }

    this.bus.emit("window:restored", { windowId, pid: record.pid });
    return true;
  }

  /**
   * Maximize a window to fill the desktop area (full viewport minus
   * the taskbar). Remembers the window's pre-maximize geometry on the
   * record so toggling back restores it exactly, the same way real
   * OS window managers do. A minimized window is restored to normal
   * first, then maximized, rather than maximizing while hidden.
   * @param {string} windowId
   */
  maximizeWindow(windowId) {
    const record = this.windows.get(windowId);
    if (!record) return false;
    if (record.state === "maximized") return true; // already maximized, no-op

    if (record.state === "minimized") {
      this.restoreWindow(windowId);
    }

    // Remember exact pre-maximize geometry so un-maximizing can put
    // the window back exactly where/how big it was.
    record._preMaximizeGeometry = {
      x: record.x,
      y: record.y,
      width: record.width,
      height: record.height
    };

    record.state = "maximized";
    record.el.classList.add("maximized");
    record.el.style.left = "0px";
    record.el.style.top = "0px";
    record.el.style.width = "100%";
    record.el.style.height = `calc(100% - ${this._taskbarHeight}px)`;

    this.focusWindow(windowId);

    this.bus.emit("window:maximized", { windowId, pid: record.pid });
    return true;
  }

  /**
   * Restore a maximized window back to its remembered pre-maximize
   * geometry. Distinct from restoreWindow() (which un-minimizes) —
   * minimize and maximize are independent states in this OS, same as
   * real window managers, so they each get their own restore path
   * rather than sharing one that would conflate the two concepts.
   * @param {string} windowId
   */
  _unmaximizeWindow(windowId) {
    const record = this.windows.get(windowId);
    if (!record) return false;
    if (record.state !== "maximized") return true; // nothing to un-maximize

    const prior = record._preMaximizeGeometry || { x: 80, y: 60, width: 480, height: 320 };
    record._preMaximizeGeometry = null;

    record.state = "normal";
    record.el.classList.remove("maximized");
    record.x = prior.x;
    record.y = prior.y;
    record.width = prior.width;
    record.height = prior.height;
    record.el.style.left = `${prior.x}px`;
    record.el.style.top = `${prior.y}px`;
    record.el.style.width = `${prior.width}px`;
    record.el.style.height = `${prior.height}px`;

    this.focusWindow(windowId);

    this.bus.emit("window:unmaximized", { windowId, pid: record.pid });
    return true;
  }

  /**
   * Toggle a window between maximized and its prior normal geometry.
   * Used by both the maximize control button and double-clicking the
   * titlebar — the two standard ways every real OS exposes this.
   * @param {string} windowId
   */
  toggleMaximize(windowId) {
    const record = this.windows.get(windowId);
    if (!record) return false;

    if (record.state === "maximized") {
      return this._unmaximizeWindow(windowId);
    }
    return this.maximizeWindow(windowId);
  }

  /** ---------------------------------------------------------------
   * Drag movement
   * ------------------------------------------------------------- */

  _onDragStart(e, windowId) {
    // Only left mouse button initiates a drag.
    if (e.button !== 0) return;

    const record = this.windows.get(windowId);
    if (!record) return;

    // A maximized window can't be dragged — same as every real OS,
    // the titlebar only un-maximizes (via double-click) or moves the
    // window once it's back to its normal geometry.
    if (record.state === "maximized") return;

    this.focusWindow(windowId);

    this._dragState = {
      windowId,
      startMouseX: e.clientX,
      startMouseY: e.clientY,
      startWinX: record.x,
      startWinY: record.y
    };
  }

  _onDragMove(e) {
    if (!this._dragState) return;

    const record = this.windows.get(this._dragState.windowId);
    if (!record) {
      this._dragState = null;
      return;
    }

    const dx = e.clientX - this._dragState.startMouseX;
    const dy = e.clientY - this._dragState.startMouseY;

    let newX = this._dragState.startWinX + dx;
    let newY = this._dragState.startWinY + dy;

    // Basic viewport clamping: keep titlebar reachable on screen,
    // and keep the titlebar above the taskbar (Phase 3) so a window
    // can never be dragged somewhere the user can't grab it back from.
    newX = Math.max(-record.width + 80, Math.min(newX, window.innerWidth - 40));
    newY = Math.max(0, Math.min(newY, window.innerHeight - this._taskbarHeight - 32));

    record.x = newX;
    record.y = newY;
    record.el.style.left = `${newX}px`;
    record.el.style.top = `${newY}px`;
  }

  _onDragEnd() {
    if (!this._dragState) return;
    const windowId = this._dragState.windowId;
    this._dragState = null;
    const record = this.windows.get(windowId);
    if (record) {
      this.bus.emit("window:moved", { windowId, x: record.x, y: record.y });
    }
  }

  /**
   * Directly set a window's position and/or size, bypassing drag
   * interaction entirely. Used by Session (Phase 9) to restore saved
   * geometry onto a freshly-spawned window. Emits "window:moved" so
   * any listener tracking position (including Session's own live
   * snapshot) stays consistent with what's actually on screen,
   * rather than drifting from a restore that happened outside the
   * normal drag path.
   * @param {string} windowId
   * @param {Object} geometry
   * @param {number} [geometry.x]
   * @param {number} [geometry.y]
   * @param {number} [geometry.width]
   * @param {number} [geometry.height]
   */
  setWindowGeometry(windowId, { x, y, width, height } = {}) {
    const record = this.windows.get(windowId);
    if (!record) return false;

    if (typeof x === "number" && typeof y === "number") {
      record.x = x;
      record.y = y;
      record.el.style.left = `${x}px`;
      record.el.style.top = `${y}px`;
    }
    if (typeof width === "number" && width > 0) {
      record.width = width;
      record.el.style.width = `${width}px`;
    }
    if (typeof height === "number" && height > 0) {
      record.height = height;
      record.el.style.height = `${height}px`;
    }

    this.bus.emit("window:moved", { windowId, x: record.x, y: record.y });
    return true;
  }

  /** ---------------------------------------------------------------
   * Queries
   * ------------------------------------------------------------- */

  getWindow(windowId) {
    return this.windows.get(windowId) || null;
  }

  getAllWindows() {
    return [...this.windows.values()];
  }

  getActiveWindowId() {
    return this._activeWindowId;
  }
}

window.WindowManager = WindowManager;
