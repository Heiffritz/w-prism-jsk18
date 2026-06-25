/**
 * assetManager.js
 * ------------------------------------------------------------------
 * Centralized resource registry for the OS.
 *
 * HARD RULE: no app or UI module is allowed to hardcode an asset
 * path like "assets/icons/about.png" directly in its own source.
 * Instead, every asset is referenced by a symbolic KEY (e.g.
 * "icon.about", "wallpaper.default", "sound.startup"), and
 * AssetManager is the only module that knows the actual path behind
 * that key. Re-pointing or re-organizing real asset files later
 * never requires touching app code — only data/assets.json.
 *
 * Responsibilities:
 *   - load data/assets.json once during boot
 *   - flatten the categorized JSON (icons/wallpapers/images/sounds/
 *     documents) into one lookup map of key -> path
 *   - getAsset(key) -> resolved path, or a built-in placeholder if
 *     the key is missing / the registry hasn't loaded yet
 *   - preload(keys[]) -> warms the browser's image cache for a batch
 *     of keys (used before rendering desktop icons, for example)
 *   - exposes everything through both direct methods AND events,
 *     same dual-access pattern as every other manager in this OS
 *
 * AssetManager does NOT touch the DOM. It only ever hands back path
 * strings. Whoever asked for the asset (DesktopEngine, an app, etc.)
 * is responsible for putting that path into an <img src> or a
 * background-image themselves.
 * ------------------------------------------------------------------
 */

class AssetManager {
  constructor(eventBus) {
    this.bus = eventBus;

    // Flat Map<assetKey, path>, built by flattening every top-level
    // category object in data/assets.json.
    this._registry = new Map();

    this._loaded = false;
    this._loadPromise = null;

    // A tiny inline fallback so the UI never shows a broken-image
    // glyph before assets.json finishes loading, or if a requested
    // key doesn't exist. 1x1 transparent PNG as a data URI — zero
    // network requests, zero risk of itself 404ing.
    this._placeholder =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUAAScy8CYAAAAASUVORK5CYII=";

    // In-memory cache of preloaded Image() objects, keyed by
    // resolved path, so repeated preload() calls for the same asset
    // don't re-trigger a network fetch.
    this._imageCache = new Map();

    // Requests that arrive via "asset:get" before the registry has
    // finished loading are queued here instead of being answered
    // immediately with a (likely wrong) placeholder fallback. They
    // are flushed with their real, correct answer once load()
    // resolves. This matters in practice: DOM construction (e.g.
    // DesktopEngine rendering icons during app registration) is
    // synchronous, while load()'s fetch() is not, so callers asking
    // for an icon during boot would otherwise always get the
    // placeholder and never be corrected once real data arrives.
    this._pendingRequests = [];

    this._bindEvents();
  }

  _bindEvents() {
    // Exposed for symmetry/testability with the rest of the OS, even
    // though in practice Kernel calls load() directly during boot.
    this.bus.on("asset:load", ({ url } = {}) => {
      this.load(url);
    });

    // Request/response pattern: a caller emits "asset:get" with a
    // key and a requestId it generated itself, then listens for
    // "asset:resolved" filtered to that same requestId. This lets
    // any module resolve an asset key without holding a direct
    // reference to AssetManager — see windowManager.js's titlebar
    // icon resolution for a real example of this pattern.
    //
    // If the registry hasn't loaded yet, the request is queued
    // rather than answered immediately — see _pendingRequests above.
    this.bus.on("asset:get", ({ key, requestId } = {}) => {
      if (!this._loaded) {
        this._pendingRequests.push({ key, requestId });
        return;
      }
      this._respondToGet(key, requestId);
    });

    this.bus.on("asset:preload", ({ keys } = {}) => {
      this.preload(keys || []);
    });
  }

  _respondToGet(key, requestId) {
    this.bus.emit("asset:resolved", {
      key,
      requestId,
      path: this.getAsset(key),
      found: this.hasAsset(key)
    });
  }

  /**
   * Answer every "asset:get" request that arrived before the
   * registry finished loading, now that real data is available.
   */
  _flushPendingRequests() {
    const queued = this._pendingRequests;
    this._pendingRequests = [];
    queued.forEach(({ key, requestId }) => this._respondToGet(key, requestId));
  }

  /**
   * Load and flatten data/assets.json. Safe to call more than once —
   * subsequent calls return the same in-flight or already-resolved
   * promise instead of re-fetching.
   * @param {string} [url="data/assets.json"]
   * @returns {Promise<void>}
   */
  load(url = "data/assets.json") {
    if (this._loadPromise) return this._loadPromise;

    this._loadPromise = fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`AssetManager: failed to fetch ${url} (status ${res.status})`);
        return res.json();
      })
      .then((data) => {
        this._flattenIntoRegistry(data);
        this._loaded = true;
        this.bus.emit("asset:ready", { count: this._registry.size });
        this._flushPendingRequests();
      })
      .catch((err) => {
        // An OS should never hard-crash because a JSON file 404'd —
        // every getAsset() call simply falls back to the placeholder
        // until/unless a later load() call succeeds. Pending
        // "asset:get" requests still need an answer even though
        // loading failed, or their callers would wait forever.
        console.error("[AssetManager] Failed to load asset registry:", err);
        this.bus.emit("asset:loadFailed", { url, error: err });
        this._flushPendingRequests();
      });

    return this._loadPromise;
  }

  /**
   * data/assets.json groups keys under categories (icons, wallpapers,
   * images, sounds, documents) purely for human readability when
   * editing the file. Internally everything is flattened into one
   * map, since callers reference assets by their full key (e.g.
   * "icon.about") regardless of which category it lives under.
   */
  _flattenIntoRegistry(data) {
    Object.keys(data).forEach((category) => {
      if (category.startsWith("_")) return; // skip "_comment" etc
      const group = data[category];
      if (typeof group !== "object" || group === null) return;
      Object.keys(group).forEach((key) => {
        if (key.startsWith("_")) return;
        this._registry.set(key, group[key]);
      });
    });
  }

  /**
   * Resolve a symbolic asset key to its real path.
   * @param {string} key
   * @returns {string} the resolved path, or a placeholder data-URI
   *          if the key is unknown / the registry hasn't loaded yet
   */
  getAsset(key) {
    if (this._registry.has(key)) {
      return this._registry.get(key);
    }
    if (!this._loaded) {
      console.warn(`[AssetManager] getAsset("${key}") called before registry finished loading; returning placeholder.`);
    } else {
      console.warn(`[AssetManager] Unknown asset key "${key}"; returning placeholder.`);
    }
    return this._placeholder;
  }

  /**
   * Returns true only if the key exists in the loaded registry
   * (distinct from getAsset, which always returns *something*).
   */
  hasAsset(key) {
    return this._registry.has(key);
  }

  /**
   * Warm the browser's image cache for a batch of asset keys. Used
   * by DesktopEngine/StartMenuEngine before first paint so icons
   * don't pop in late. Resolves once every image has either loaded
   * or failed — failures never reject the whole batch, since a
   * missing decorative icon shouldn't be able to block boot.
   * @param {string[]} keys
   * @returns {Promise<void>}
   */
  preload(keys) {
    const loads = keys.map((key) => {
      const path = this.getAsset(key);
      if (this._imageCache.has(path)) return Promise.resolve();

      return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve();
        img.onerror = () => {
          console.warn(`[AssetManager] preload failed for key "${key}" (path: ${path})`);
          resolve(); // never reject — a missing icon shouldn't block boot
        };
        img.src = path;
        this._imageCache.set(path, img);
      });
    });

    return Promise.all(loads).then(() => {
      this.bus.emit("asset:preloaded", { count: keys.length });
    });
  }

  /** Returns every known asset key — useful for debugging/dev tools. */
  getAllKeys() {
    return [...this._registry.keys()];
  }

  /** @returns {boolean} whether data/assets.json has finished loading */
  isLoaded() {
    return this._loaded;
  }
}

window.AssetManager = AssetManager;
