/**
 * vfs.js
 * ------------------------------------------------------------------
 * Virtual File System — a simulated folder/file hierarchy that
 * powers a future Explorer app (Phase 5/6) and lets other apps
 * "open a document" without ever touching a real filesystem (browsers
 * can't, and shouldn't be able to, read arbitrary local files anyway).
 *
 * The tree itself lives in data/vfs.json and is loaded once. Every
 * node is either:
 *   { type: "folder", name, children: [...] }
 *   { type: "file", name, fileType, assetKey?  content? }
 *
 * A file node carries EITHER an assetKey (resolved later through
 * AssetManager — used for binary/media files like PDFs and images)
 * OR inline `content` (used for small text files). It never stores
 * a raw path itself — that rule mirrors AssetManager's own.
 *
 * Responsibilities:
 *   - load() data/vfs.json once
 *   - resolve(path) -> the node at a given path, or null
 *   - listDir(path) -> array of child nodes (folders + files)
 *   - readFile(path) -> { fileType, content } for text files, or
 *     { fileType, assetKey } for asset-backed files — VFS does NOT
 *     resolve the assetKey itself (that's AssetManager's job); it
 *     just hands back the key for the caller to resolve via
 *     "asset:get", keeping the two modules decoupled.
 *
 * Paths are simple slash-delimited strings matching node `name`
 * fields case-sensitively, e.g. "/My Computer/Documents/Read Me.txt".
 * The leading slash is optional and stripped if present.
 * ------------------------------------------------------------------
 */

class VFS {
  constructor(eventBus) {
    this.bus = eventBus;

    this._root = null;
    this._loaded = false;
    this._loadPromise = null;

    // Same rationale as AssetManager's _pendingRequests: a caller
    // (e.g. the future Explorer app) may emit vfs:resolve/listDir/
    // readFile synchronously during its own construction, before
    // load()'s fetch() has resolved. Queuing and re-answering once
    // vfs:ready fires means that caller gets the correct answer
    // instead of an empty/null result it never finds out was wrong.
    this._pendingRequests = []; // { type: 'resolve'|'listDir'|'readFile', path, requestId }

    this._bindEvents();
  }

  _bindEvents() {
    this.bus.on("vfs:load", ({ url } = {}) => {
      this.load(url);
    });

    // Request/response pairs, same pattern as AssetManager's
    // asset:get/asset:resolved, so apps never need a direct
    // reference to the VFS instance.
    this.bus.on("vfs:resolve", ({ path, requestId } = {}) => {
      if (!this._loaded) {
        this._pendingRequests.push({ type: "resolve", path, requestId });
        return;
      }
      this._respondToResolve(path, requestId);
    });

    this.bus.on("vfs:listDir", ({ path, requestId } = {}) => {
      if (!this._loaded) {
        this._pendingRequests.push({ type: "listDir", path, requestId });
        return;
      }
      this._respondToListDir(path, requestId);
    });

    this.bus.on("vfs:readFile", ({ path, requestId } = {}) => {
      if (!this._loaded) {
        this._pendingRequests.push({ type: "readFile", path, requestId });
        return;
      }
      this._respondToReadFile(path, requestId);
    });
  }

  _respondToResolve(path, requestId) {
    this.bus.emit("vfs:resolved", { requestId, path, node: this.resolve(path) });
  }

  _respondToListDir(path, requestId) {
    this.bus.emit("vfs:dirListed", { requestId, path, children: this.listDir(path) });
  }

  _respondToReadFile(path, requestId) {
    this.bus.emit("vfs:fileRead", { requestId, path, file: this.readFile(path) });
  }

  _flushPendingRequests() {
    const queued = this._pendingRequests;
    this._pendingRequests = [];
    queued.forEach(({ type, path, requestId }) => {
      if (type === "resolve") this._respondToResolve(path, requestId);
      if (type === "listDir") this._respondToListDir(path, requestId);
      if (type === "readFile") this._respondToReadFile(path, requestId);
    });
  }

  /**
   * Load data/vfs.json. Safe to call more than once — subsequent
   * calls return the same in-flight or already-resolved promise.
   * @param {string} [url="data/vfs.json"]
   * @returns {Promise<void>}
   */
  load(url = "data/vfs.json") {
    if (this._loadPromise) return this._loadPromise;

    this._loadPromise = fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`VFS: failed to fetch ${url} (status ${res.status})`);
        return res.json();
      })
      .then((data) => {
        this._root = data;
        this._loaded = true;
        this.bus.emit("vfs:ready", { rootName: data.name });
        this._flushPendingRequests();
      })
      .catch((err) => {
        console.error("[VFS] Failed to load file system data:", err);
        this.bus.emit("vfs:loadFailed", { url, error: err });
        this._flushPendingRequests();
      });

    return this._loadPromise;
  }

  /**
   * Split a path string into clean segments, e.g.
   * "/My Computer/Documents/" -> ["My Computer", "Documents"]
   */
  _splitPath(path) {
    if (!path || path === "/") return [];
    return path.split("/").filter((seg) => seg.length > 0);
  }

  /**
   * Walk the tree by name at each level, starting from root.
   * The VFS root node itself is named "root" but is NOT part of
   * the path a caller types — paths start from its children
   * (e.g. "My Computer/Documents", not "root/My Computer/Documents").
   * @param {string} path
   * @returns {Object|null} the matching node, or null if not found
   */
  resolve(path) {
    if (!this._loaded) {
      console.warn(`[VFS] resolve("${path}") called before VFS finished loading.`);
      return null;
    }

    const segments = this._splitPath(path);
    let current = this._root;

    for (const segment of segments) {
      if (!current || current.type !== "folder" || !Array.isArray(current.children)) {
        return null;
      }
      const next = current.children.find((child) => child.name === segment);
      if (!next) return null;
      current = next;
    }

    return current;
  }

  /**
   * List the children of a folder at the given path. Returns an
   * empty array for files, missing paths, or an unloaded VFS —
   * never throws, since a UI listing should always have *something*
   * iterable to render even on failure.
   * @param {string} path - "" or "/" for the VFS root's children
   * @returns {Object[]}
   */
  listDir(path) {
    const node = path === "" || path === "/" ? this._root : this.resolve(path);
    if (!node || node.type !== "folder" || !Array.isArray(node.children)) {
      return [];
    }
    return node.children;
  }

  /**
   * Read a file node's content descriptor.
   * @param {string} path
   * @returns {{fileType: string, content?: string, assetKey?: string}|null}
   *          null if the path doesn't resolve to a file node
   */
  readFile(path) {
    const node = this.resolve(path);
    if (!node || node.type !== "file") return null;

    return {
      fileType: node.fileType,
      content: node.content,
      assetKey: node.assetKey
    };
  }

  /** @returns {boolean} whether vfs.json has finished loading */
  isLoaded() {
    return this._loaded;
  }
}

window.VFS = VFS;
