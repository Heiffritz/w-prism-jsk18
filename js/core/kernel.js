/**
 * kernel.js
 * ------------------------------------------------------------------
 * The Kernel is the "brain" of the OS. Its only job is BOOTING:
 *   1. Instantiate core subsystems in the correct dependency order
 *   2. Wire them to the shared EventBus
 *   3. Run the boot pipeline (a list of ordered boot steps)
 *   4. Announce "kernel:ready" once everything is alive
 *
 * The Kernel does NOT contain business logic for windows, processes,
 * or apps — it only orchestrates startup. Once booted, every other
 * module operates independently via the EventBus; the Kernel mostly
 * steps back; (in later phases it also exposes a couple of small
 * OS-level utilities like reboot/shutdown for the session system).
 *
 * CURRENT BOOT PIPELINE (Phases 1-4):
 *   eventBus -> processManager -> assetManager -> vfs -> windowManager
 *   -> contextMenuEngine -> desktopEngine -> taskbarEngine -> startMenuEngine
 *
 * assetManager and vfs each kick off an async JSON load (fetch)
 * during their own boot step but do NOT block the boot loop —
 * "kernel:ready" means every module is constructed and listening,
 * not that every async load has finished. Modules that need
 * asset/VFS data listen for the separate "asset:ready" / "vfs:ready"
 * events instead.
 * ------------------------------------------------------------------
 */

class Kernel {
  constructor() {
    this.bus = window.eventBus; // singleton created in eventBus.js
    this.booted = false;

    // Ordered list of { name, fn } boot steps. Later phases push
    // additional steps onto this array (e.g. "windowManager",
    // "vfs", "assetManager", "desktopEngine"...).
    this._bootSteps = [];

    // Subsystem registry — e.g. kernel.system.processManager
    this.system = {};

    this._registerCoreBootSteps();
  }

  /**
   * Phase 1 boot steps: EventBus already exists globally by the time
   * this file runs (script load order in index.html guarantees it).
   * Here we just bring up ProcessManager.
   */
  _registerCoreBootSteps() {
    this.addBootStep("eventBus", () => {
      if (!window.eventBus) {
        throw new Error("EventBus must be initialized before Kernel boot.");
      }
      // already instantiated — just confirm presence
      return window.eventBus;
    });

    // PHASE 8: ThemeManager boots immediately after eventBus, before
    // any UI module constructs DOM, so the Luna (default) theme's
    // CSS custom properties are already applied to <html> by the
    // time WindowManager/DesktopEngine/TaskbarEngine/StartMenuEngine
    // create their first elements. Nothing visually "pops in"
    // unthemed for a frame.
    this.addBootStep("themeManager", () => {
      const tm = new ThemeManager(this.bus);
      this.system.themeManager = tm;
      return tm;
    });

    this.addBootStep("processManager", () => {
      const pm = new ProcessManager(this.bus);
      this.system.processManager = pm;
      return pm;
    });

    // PHASE 4: AssetManager + VFS — the OS resource layer. Both kick
    // off an async JSON load (fetch) immediately, but the boot LOOP
    // itself stays synchronous: a boot step's job here is just
    // "construct the manager and start its load", not "wait for the
    // load to finish". This keeps boot() simple and matches the
    // reactive pattern used everywhere else in the OS — anything
    // that depends on assets/VFS data (DesktopEngine's icons, the
    // future Explorer app) listens for "asset:ready" / "vfs:ready"
    // rather than assuming the data is available the instant
    // "kernel:ready" fires.
    this.addBootStep("assetManager", () => {
      const am = new AssetManager(this.bus);
      am.load();
      this.system.assetManager = am;
      return am;
    });

    this.addBootStep("vfs", () => {
      const vfs = new VFS(this.bus);
      vfs.load();
      this.system.vfs = vfs;
      return vfs;
    });

    // PHASE 2: WindowManager — the UI virtualization layer. Boots
    // after ProcessManager since windows are conceptually owned by
    // processes (a window's record carries a pid), even though the
    // two modules never reference each other directly — only via bus.
    this.addBootStep("windowManager", () => {
      const wm = new WindowManager(this.bus);
      this.system.windowManager = wm;
      return wm;
    });

    // PHASE 3: Desktop Runtime System — the OS "surface" UI.
    // ContextMenuEngine boots first since Desktop/Taskbar/StartMenu
    // all emit "contextmenu:open" and assume something is listening.
    this.addBootStep("contextMenuEngine", () => {
      const cm = new ContextMenuEngine(this.bus);
      this.system.contextMenuEngine = cm;
      return cm;
    });

    this.addBootStep("desktopEngine", () => {
      const de = new DesktopEngine(this.bus);
      this.system.desktopEngine = de;
      return de;
    });

    this.addBootStep("taskbarEngine", () => {
      const tb = new TaskbarEngine(this.bus);
      this.system.taskbarEngine = tb;
      return tb;
    });

    // Suggestion #4: balloon-style notifications anchored near the
    // taskbar clock/tray, e.g. the first-visit welcome message.
    this.addBootStep("notificationService", () => {
      const ns = new NotificationService(this.bus);
      this.system.notificationService = ns;
      return ns;
    });

    this.addBootStep("startMenuEngine", () => {
      const sm = new StartMenuEngine(this.bus);
      this.system.startMenuEngine = sm;
      return sm;
    });

    // PHASE 9: Session boots last. It only listens to events emitted
    // by modules that already exist by this point (WindowManager,
    // ProcessManager, ThemeManager) and waits for "kernel:ready"
    // itself before attempting any restore, so its exact position in
    // the boot order relative to the runtime UI modules above isn't
    // load-bearing — it's placed last simply to read top-to-bottom as
    // "the newest addition".
    this.addBootStep("session", () => {
      const session = new Session(this.bus);
      this.system.session = session;
      return session;
    });
  }

  /**
   * Allows later phases (and main.js) to append additional boot
   * steps without modifying kernel.js itself, e.g.:
   *   kernel.addBootStep("windowManager", () => new WindowManager(bus))
   */
  addBootStep(name, fn) {
    this._bootSteps.push({ name, fn });
  }

  /**
   * Run every registered boot step in order. Each step's return value
   * is stored in this.system[name] (unless it returns undefined).
   * Emits "kernel:bootStep" after each step and "kernel:ready" at the end.
   */
  boot() {
    if (this.booted) {
      console.warn("[Kernel] boot() called but kernel is already booted.");
      return;
    }

    console.log("[Kernel] Boot sequence starting...");
    this.bus.emit("kernel:bootStart", { steps: this._bootSteps.map((s) => s.name) });

    for (const step of this._bootSteps) {
      try {
        const result = step.fn();
        if (result !== undefined && !this.system[step.name]) {
          this.system[step.name] = result;
        }
        console.log(`[Kernel] Boot step "${step.name}" OK`);
        this.bus.emit("kernel:bootStep", { name: step.name, ok: true });
      } catch (err) {
        console.error(`[Kernel] Boot step "${step.name}" FAILED:`, err);
        this.bus.emit("kernel:bootStep", { name: step.name, ok: false, error: err });
        this.bus.emit("kernel:bootFailed", { step: step.name, error: err });
        // A failed core boot step halts the boot — an OS can't run
        // half-initialized. Later phases may choose to make specific
        // steps non-fatal, but core steps (bus, processManager) must
        // succeed or nothing else is safe to start.
        return;
      }
    }

    this.booted = true;
    console.log("[Kernel] Boot sequence complete.");
    this.bus.emit("kernel:ready", { system: Object.keys(this.system) });
  }

  /** Convenience accessor used by later phases / main.js */
  get(name) {
    return this.system[name];
  }
}

window.Kernel = Kernel;
