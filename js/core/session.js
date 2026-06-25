/**
 * session.js
 * ------------------------------------------------------------------
 * Persists OS session state across page reloads using localStorage.
 *
 * PERSISTED:
 *   - which apps were open, and each window's position/size/state
 *   - active theme/wallpaper selection (theme persistence piggybacks
 *     on ThemeManager's "theme:applied" event)
 *   - minigame high score is NOT handled here — it already persists
 *     independently via minigame.app.js's own localStorage key,
 *     intentionally kept separate since it's game data, not window
 *     session state.
 *
 * ARCHITECTURE: Session never touches window/process DOM directly.
 * It only LISTENS to lifecycle events (window:created, window:moved,
 * window:closed, etc) to build its snapshot, and on restore it only
 * EMITS "process:spawn" + "window:create" options — the actual
 * window creation still goes through ProcessManager/WindowManager
 * exactly like a normal user-initiated launch. Session restoring a
 * window looks identical, from every other module's perspective, to
 * the user opening that app themselves.
 *
 * RESTORE TIMING: Session waits for "kernel:ready" before restoring,
 * since ProcessManager/WindowManager must exist first. It also
 * staggers restored spawns slightly (50ms apart) rather than firing
 * them all in one synchronous burst, purely so the open-window
 * animation from Phase 8 is visually distinguishable per window
 * instead of all windows popping in simultaneously.
 * ------------------------------------------------------------------ */

class Session {
  constructor(eventBus, options = {}) {
    this.bus = eventBus;
    this.storageKey = options.storageKey || "prism.session.v1";
    this.saveDebounceMs = options.saveDebounceMs ?? 400;
    this.restoreStaggerMs = options.restoreStaggerMs ?? 50;

    // Map<windowId, { appId, pid, x, y, width, height, state }>
    // Rebuilt continuously as windows are created/moved/closed, and
    // is the exact thing serialized to localStorage on save.
    this._liveWindows = new Map();
    // Map<pid, appId> so window-level events (which only carry pid)
    // can be translated back to an appId for persistence.
    this._pidToAppId = new Map();

    this._wallpaperTheme = null;
    this._wallpaper = null;
    this._saveTimer = null;
    this._restoring = false;

    this._bindEvents();
  }

  _bindEvents() {
    this.bus.on("process:spawned", ({ pid, appId }) => {
      this._pidToAppId.set(pid, appId);
    });
    this.bus.on("process:killed", ({ pid }) => {
      this._pidToAppId.delete(pid);
    });

    this.bus.on("window:created", ({ windowId, pid, title }) => {
      const appId = this._pidToAppId.get(pid);
      if (!appId) return; // window not tied to a known app (shouldn't normally happen)
      this._liveWindows.set(windowId, {
        appId,
        pid,
        title,
        x: null,
        y: null,
        width: null,
        height: null,
        state: "normal"
      });
      this._scheduleSave();
    });

    this.bus.on("window:moved", ({ windowId, x, y }) => {
      const entry = this._liveWindows.get(windowId);
      if (entry) {
        entry.x = x;
        entry.y = y;
        this._scheduleSave();
      }
    });

    this.bus.on("window:minimized", ({ windowId }) => {
      const entry = this._liveWindows.get(windowId);
      if (entry) {
        entry.state = "minimized";
        this._scheduleSave();
      }
    });

    this.bus.on("window:restored", ({ windowId }) => {
      const entry = this._liveWindows.get(windowId);
      if (entry) {
        entry.state = "normal";
        this._scheduleSave();
      }
    });

    this.bus.on("window:closed", ({ windowId }) => {
      this._liveWindows.delete(windowId);
      this._scheduleSave();
    });

    this.bus.on("theme:applied", ({ theme }) => {
      this._wallpaperTheme = theme;
      this._scheduleSave();
    });

    this.bus.on("wallpaper:applied", ({ wallpaper }) => {
      this._wallpaper = wallpaper;
      this._scheduleSave();
    });

    // ThemeManager applies its initial theme synchronously inside
    // its OWN constructor, which runs during an EARLIER boot step
    // than Session's — by the time Session exists and could listen
    // for "theme:applied", that first emission has already happened
    // and is gone (EventBus does not replay past events). The
    // "theme:applied" listener above only ever catches a LATER theme
    // change; the CURRENT theme at Session's own construction time is
    // fetched once here via the existing theme:get/theme:current
    // request-response pair, which works regardless of boot order.
    const initThemeRequestId = `session-init-theme-${Math.random().toString(36).slice(2)}`;
    const unsubInitTheme = this.bus.on("theme:current", (payload) => {
      if (payload.requestId !== initThemeRequestId) return;
      unsubInitTheme();
      this._wallpaperTheme = payload.theme;
    });
    this.bus.emit("theme:get", { requestId: initThemeRequestId });

    // Same init-timing fix, same reason, for wallpaper:applied.
    const initWallpaperRequestId = `session-init-wallpaper-${Math.random().toString(36).slice(2)}`;
    const unsubInitWallpaper = this.bus.on("wallpaper:current", (payload) => {
      if (payload.requestId !== initWallpaperRequestId) return;
      unsubInitWallpaper();
      this._wallpaper = payload.wallpaper;
    });
    this.bus.emit("wallpaper:get", { requestId: initWallpaperRequestId });

    // Restore once the full module graph exists. Asset/VFS readiness
    // isn't required for restore itself (restoring a window doesn't
    // need icons to have loaded), so this intentionally does NOT wait
    // on asset:ready/vfs:ready the way Bootloader does.
    this.bus.on("kernel:ready", () => {
      this.restore();
    });

    // Allow an explicit manual save/clear, e.g. from a future
    // "Log Off" or settings action, consistent with every other
    // module's event-driven API surface.
    this.bus.on("session:save", () => this.save());
    this.bus.on("session:clear", () => this.clear());
  }

  /** ---------------------------------------------------------------
   * Saving
   * ------------------------------------------------------------- */

  _scheduleSave() {
    if (this._restoring) return; // don't save WHILE we're restoring from a save
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this.save(), this.saveDebounceMs);
  }

  /**
   * Serialize current live window state + theme to localStorage.
   * Safe to call directly (e.g. via "session:save") in addition to
   * the debounced automatic path.
   */
  save() {
    const snapshot = {
      version: 1,
      savedAt: Date.now(),
      theme: this._wallpaperTheme,
      wallpaper: this._wallpaper,
      windows: [...this._liveWindows.values()].map((w) => ({
        appId: w.appId,
        x: w.x,
        y: w.y,
        width: w.width,
        height: w.height,
        state: w.state
      }))
    };

    try {
      window.localStorage.setItem(this.storageKey, JSON.stringify(snapshot));
      this.bus.emit("session:saved", { windowCount: snapshot.windows.length });
    } catch (err) {
      // localStorage can throw (quota exceeded, privacy mode, etc) —
      // failing to persist a session should never crash the OS.
      console.warn("[Session] Failed to save session:", err);
      this.bus.emit("session:saveFailed", { error: err });
    }
  }

  /**
   * Remove any saved session data from localStorage. Does not affect
   * currently-open windows — it only clears what would be restored
   * on the NEXT page load.
   */
  clear() {
    try {
      window.localStorage.removeItem(this.storageKey);
      this.bus.emit("session:cleared", {});
    } catch (err) {
      console.warn("[Session] Failed to clear saved session:", err);
    }
  }

  /** ---------------------------------------------------------------
   * Restoring
   * ------------------------------------------------------------- */

  /**
   * Read the saved snapshot (if any) and re-spawn each saved window,
   * staggered slightly. Each restored app is spawned via the normal
   * "process:spawn" event — Session does not create windows itself.
   * Window position/size restoration happens by passing x/y/width/
   * height through as spawn args, which each app's factory is
   * expected to forward into its own "window:create" call (see the
   * _restoreWindowOptionsFor helper docs below for the exact
   * mechanism, since most existing apps from Phases 5-7 don't
   * currently read spawn args for this purpose — this is wired
   * through generically rather than requiring every app to change).
   */
  restore() {
    let raw;
    try {
      raw = window.localStorage.getItem(this.storageKey);
    } catch (err) {
      console.warn("[Session] localStorage unavailable, skipping restore:", err);
      return;
    }
    if (!raw) {
      this.bus.emit("session:restored", { windowCount: 0 });
      return;
    }

    let snapshot;
    try {
      snapshot = JSON.parse(raw);
    } catch (err) {
      console.warn("[Session] Saved session data was corrupt JSON, ignoring it:", err);
      this.bus.emit("session:restoreFailed", { error: err });
      return;
    }

    if (!snapshot || !Array.isArray(snapshot.windows)) {
      this.bus.emit("session:restored", { windowCount: 0 });
      return;
    }

    this._restoring = true;

    if (snapshot.theme) {
      this.bus.emit("theme:set", { theme: snapshot.theme });
    }
    if (snapshot.wallpaper) {
      this.bus.emit("wallpaper:set", { wallpaper: snapshot.wallpaper });
    }

    snapshot.windows.forEach((winInfo, index) => {
      setTimeout(() => {
        this._restoreOneWindow(winInfo);
        // Once the last staggered restore has fired, allow normal
        // saving to resume — restoring itself shouldn't trigger a
        // cascade of saves for state we just loaded FROM a save.
        if (index === snapshot.windows.length - 1) {
          setTimeout(() => {
            this._restoring = false;
          }, 50);
        }
      }, index * this.restoreStaggerMs);
    });

    if (snapshot.windows.length === 0) {
      this._restoring = false;
    }

    this.bus.emit("session:restored", { windowCount: snapshot.windows.length });
  }

  /**
   * Spawn one saved app and arrange for its window to be created at
   * the saved position/size. Apps from Phases 5-7 spawn with a
   * hardcoded width/height/title and don't read ctx.args for window
   * geometry, so Session listens for THIS specific window:created
   * event (matched by the pid this spawn call produces) and
   * repositions/re-states it immediately afterward via
   * WindowManager's existing events, rather than requiring every
   * existing app file to be rewritten to honor incoming position
   * args. This keeps Session additive rather than a breaking change
   * to the app system.
   */
  _restoreOneWindow(winInfo) {
    // We need to know which NEW pid gets created by this specific
    // spawn call, since "process:spawned" is a global event covering
    // every process that has ever spawned.
    //
    // CRITICAL ORDERING: ProcessManager.spawn() emits "process:spawned"
    // BEFORE running the app's factory (see processManager.js's own
    // Phase 3 fix), and the factory itself synchronously triggers
    // "window:create" -> WindowManager's "window:created" — ALL of
    // this happens inside the single emit() call below, before it
    // returns. That means BOTH listeners (for process:spawned AND
    // window:created) must be registered BEFORE calling emit(), or
    // they'll be listening for events that already fired and are
    // gone. (An earlier version of this method registered the
    // window:created listener AFTER emit() returned, which missed
    // the event entirely and silently failed to restore geometry —
    // caught via testing, not assumed correct.)
    let capturedPid = null;
    const unsubSpawned = this.bus.on("process:spawned", (record) => {
      capturedPid = record.pid;
    });

    const unsubCreated = this.bus.on("window:created", (payload) => {
      // capturedPid is set synchronously by the listener above,
      // which fires before this one for the same spawn call (see
      // ordering note above), so it's already valid here.
      if (payload.pid !== capturedPid) return;
      unsubCreated();

      if (winInfo.x !== null && winInfo.y !== null) {
        this.bus.emit("window:restoreGeometry", {
          windowId: payload.windowId,
          x: winInfo.x,
          y: winInfo.y,
          width: winInfo.width,
          height: winInfo.height
        });
      }

      if (winInfo.state === "minimized") {
        this.bus.emit("window:minimize", { windowId: payload.windowId });
      }
    });

    this.bus.emit("process:spawn", { appId: winInfo.appId });
    unsubSpawned();

    if (capturedPid === null) {
      // App failed to spawn (e.g. unknown appId from an old/stale
      // saved session referencing an app that no longer exists) —
      // nothing to reposition. Clean up the now-orphaned listener
      // too, since it will otherwise sit waiting forever for a
      // window:created that will never come for this pid.
      unsubCreated();
    }
  }
}

window.Session = Session;
