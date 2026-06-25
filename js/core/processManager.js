/**
 * processManager.js
 * ------------------------------------------------------------------
 * Tracks every running "application" in the OS as a PROCESS.
 *
 * In a real OS, a process is a running program with memory, state,
 * and a lifecycle (spawn -> run -> [suspend] -> kill).
 *
 * In Windows Prism JSK, a "process" is the runtime instance of one
 * app module (about.app.js, projects.app.js, etc). The ProcessManager
 * does NOT know how to render anything — it has zero DOM knowledge.
 * It only tracks:
 *   - which apps are running
 *   - their PID (process id)
 *   - their state (running / suspended / killed)
 *   - metadata (title, icon key, single-instance flag, owning windowId)
 *
 * It talks to the rest of the OS exclusively through EventBus.
 * It does not import WindowManager. It does not import apps directly
 * by reference — apps register themselves as "spawnable" via the
 * Kernel during boot, and ProcessManager just holds the registry.
 * ------------------------------------------------------------------
 */

class ProcessManager {
  constructor(eventBus) {
    this.bus = eventBus;

    // PID counter — every process gets a unique incrementing id
    this._pidCounter = 1000;

    // Map<pid, processRecord>
    this.processes = new Map();

    // Map<appId, appDefinition> — registered by Kernel during boot,
    // populated from each app module. appDefinition looks like:
    // { appId, title, icon, singleInstance, factory(processContext) }
    this.registry = new Map();

    this._bindEvents();
  }

  _bindEvents() {
    // Any module can request a new process via this event instead
    // of calling spawn() directly. This keeps ProcessManager reachable
    // purely through the bus, consistent with the rest of the OS.
    this.bus.on("process:spawn", ({ appId, args } = {}) => {
      this.spawn(appId, args);
    });

    this.bus.on("process:kill", ({ pid } = {}) => {
      this.kill(pid);
    });

    // BUGFIX: closing a window via its own × button only told
    // WindowManager to remove that window — it never killed the
    // owning PROCESS. TaskbarEngine only removes a taskbar button on
    // "process:killed", so the process (and its taskbar button) was
    // staying alive forever with no window, even after the user
    // closed it. Mirrors the existing opposite-direction handler in
    // windowManager.js (process:killed -> auto-close its window):
    // here, window:closed -> kill its owning process, matching real
    // OS behavior where closing an app's only window quits the app.
    // kill() is already a safe no-op if the process is already gone
    // (e.g. it was the process that initiated the close), so this
    // can't create a kill <-> close infinite loop.
    this.bus.on("window:closed", ({ pid } = {}) => {
      if (pid !== null && pid !== undefined) this.kill(pid);
    });

    this.bus.on("process:suspend", ({ pid } = {}) => {
      this.suspend(pid);
    });

    this.bus.on("process:resume", ({ pid } = {}) => {
      this.resume(pid);
    });

    // Apps register themselves here (called by Kernel as it loads
    // each app module during boot).
    this.bus.on("process:registerApp", (appDefinition) => {
      this.registerApp(appDefinition);
    });

    // UI modules (DesktopEngine, TaskbarEngine, StartMenuEngine) may
    // boot after some apps are already registered, or may simply
    // prefer a pull model on startup instead of relying purely on
    // having caught every past "process:appRegistered" event. This
    // lets them ask "what apps exist right now?" without holding a
    // direct reference to ProcessManager.
    this.bus.on("process:requestRoster", () => {
      this.bus.emit("process:roster", { apps: this.getRegisteredApps() });
    });

    // Same idea for currently-running processes (used by TaskbarEngine
    // to build its initial set of taskbar buttons).
    this.bus.on("process:requestList", () => {
      this.bus.emit("process:list", { processes: this.getAllProcesses() });
    });
  }

  /**
   * Register an app as "installed" / spawnable. This does not run it —
   * it just makes the OS aware that this app exists.
   */
  registerApp(appDefinition) {
    if (!appDefinition || !appDefinition.appId) {
      console.error("[ProcessManager] Invalid app definition:", appDefinition);
      return;
    }
    this.registry.set(appDefinition.appId, appDefinition);
    this.bus.emit("process:appRegistered", { appId: appDefinition.appId });
  }

  /**
   * Spawn a new process from a registered app.
   * @param {string} appId
   * @param {*} args - optional launch arguments (e.g. file to open)
   * @returns {number|null} pid of the new process, or null on failure
   */
  spawn(appId, args) {
    const appDef = this.registry.get(appId);
    if (!appDef) {
      console.error(`[ProcessManager] No app registered with id "${appId}"`);
      this.bus.emit("process:spawnFailed", { appId, reason: "not_registered" });
      return null;
    }

    // Single-instance apps: if already running, focus it instead of
    // spawning a duplicate.
    if (appDef.singleInstance) {
      const existing = [...this.processes.values()].find(
        (p) => p.appId === appId && p.state !== "killed"
      );
      if (existing) {
        this.bus.emit("process:focusRequested", { pid: existing.pid });
        return existing.pid;
      }
    }

    const pid = this._pidCounter++;
    const record = {
      pid,
      appId,
      title: appDef.title,
      icon: appDef.icon,
      state: "running", // running | suspended | killed
      windowId: null, // set once WindowManager creates a window for it
      startedAt: Date.now(),
      args: args || null
    };

    this.processes.set(pid, record);

    // Emit process:spawned BEFORE running the app's factory. This
    // ordering matters: an app's factory typically emits
    // "window:create" synchronously, which causes WindowManager to
    // immediately emit "window:created" and "window:focused" for
    // this same pid. Anything that reacts to process:spawned by
    // preparing per-pid bookkeeping (e.g. TaskbarEngine creating a
    // taskbar button) needs that bookkeeping to already exist before
    // those window events arrive, or it has nowhere to record them.
    this.bus.emit("process:spawned", { ...record });

    // The app's factory function is the actual app module's entry
    // point. It receives a "processContext" — a small API surface
    // (pid, emit helpers) — but NOT direct references to other
    // managers. It must talk back to the OS only via EventBus.
    const context = this._buildProcessContext(record);

    try {
      appDef.factory(context);
    } catch (err) {
      console.error(`[ProcessManager] App "${appId}" crashed on launch:`, err);
      this.bus.emit("system:error", { source: "ProcessManager", appId, error: err });
      this.kill(pid);
      return null;
    }

    return pid;
  }

  /**
   * Build the limited context object passed into an app's factory.
   * Apps get a `pid` and convenience emit/on helpers — they talk back
   * to the OS only via EventBus, never via direct manager references.
   */
  _buildProcessContext(record) {
    return {
      pid: record.pid,
      appId: record.appId,
      args: record.args,
      emit: (eventName, payload) => this.bus.emit(eventName, { ...payload, pid: record.pid }),
      on: (eventName, handler) => this.bus.on(eventName, handler),
      setWindowId: (windowId) => {
        record.windowId = windowId;
      }
    };
  }

  /**
   * Kill a process by pid. Emits "process:killed" so WindowManager
   * and TaskbarEngine can clean up anything tied to this pid.
   */
  kill(pid) {
    const record = this.processes.get(pid);
    if (!record) return false;

    record.state = "killed";
    this.bus.emit("process:killed", { pid, appId: record.appId, windowId: record.windowId });

    this.processes.delete(pid);
    return true;
  }

  suspend(pid) {
    const record = this.processes.get(pid);
    if (!record) return false;
    record.state = "suspended";
    this.bus.emit("process:suspended", { pid });
    return true;
  }

  resume(pid) {
    const record = this.processes.get(pid);
    if (!record) return false;
    record.state = "running";
    this.bus.emit("process:resumed", { pid });
    return true;
  }

  /** Queries ------------------------------------------------------------ */

  getProcess(pid) {
    return this.processes.get(pid) || null;
  }

  getAllProcesses() {
    return [...this.processes.values()];
  }

  getRegisteredApps() {
    return [...this.registry.values()];
  }

  isRunning(appId) {
    return [...this.processes.values()].some(
      (p) => p.appId === appId && p.state !== "killed"
    );
  }
}

window.ProcessManager = ProcessManager;
