/**
 * gallery.app.js
 * ------------------------------------------------------------------
 * The "Gallery" app — a thumbnail grid + full-size image viewer.
 * Same registration/factory/window pattern as every other app (see
 * about.app.js for the full architecture note).
 *
 * Every image is referenced by an AssetManager KEY (e.g.
 * "image.gallery_1"), never a raw path. This app resolves each key
 * via the asset:get/asset:resolved event pair, same as every other
 * module in the OS — it never imports or calls AssetManager directly.
 *
 * IMPORTANT, STATED HONESTLY: this project does not ship real photo
 * files. The keys below ARE registered in data/assets.json and DO
 * resolve to real path strings — the asset-resolution pipeline is
 * fully real and fully tested — but the actual .jpg files at those
 * paths don't exist on disk yet (that's real artwork, deferred to
 * whoever deploys this project with their own photos, same as the
 * app icons are deferred to Phase 8). Each thumbnail therefore shows
 * a graceful broken-image fallback via onerror, rather than a raw
 * broken-image browser icon — this is the CORRECT and EXPECTED
 * behavior for this phase, not a bug.
 * ------------------------------------------------------------------
 */

(function registerGalleryApp() {
  const APP_ID = "gallery";

  const GALLERY_ITEMS = [
    { id: "g1", assetKey: "image.gallery_1", caption: "Gallery Image 1", category: "3D Models" },
    { id: "g2", assetKey: "image.gallery_2", caption: "Gallery Image 2", category: "Pixel Art" },
    { id: "g3", assetKey: "image.gallery_3", caption: "Gallery Image 3", category: "Game Projects" },
    { id: "g4", assetKey: "image.gallery_4", caption: "Gallery Image 4", category: "3D Models" }
  ];

  const CATEGORIES = ["All", "3D Models", "Pixel Art", "Game Projects"];

  window.eventBus.on("kernel:ready", () => {
    window.eventBus.emit("process:registerApp", {
      appId: APP_ID,
      title: "Gallery",
      icon: "icon.gallery",
      singleInstance: true,
      factory: galleryAppFactory
    });
  });

  function galleryAppFactory(ctx) {
    const unsubscribe = ctx.on("window:created", (payload) => {
      if (payload.pid !== ctx.pid) return;
      unsubscribe();
      ctx.setWindowId(payload.windowId);
      const initialCategory = (ctx.args && CATEGORIES.includes(ctx.args.category)) ? ctx.args.category : "All";
      renderGallery(payload.contentEl, ctx, initialCategory);

      // Single-instance apps don't re-run their factory on a repeat
      // spawn (ProcessManager just focuses the existing window) — so
      // a second "open Gallery to category X" request while it's
      // already running can't reach us via ctx.args again. This
      // listens for that case directly instead.
      ctx.on("gallery:setCategory", ({ category }) => {
        if (!CATEGORIES.includes(category)) return;
        const tabEl = payload.contentEl.querySelector(`.app-gallery-tab[data-category="${category}"]`);
        if (tabEl) tabEl.click();
      });
    });

    ctx.emit("window:create", {
      title: "Gallery",
      icon: "icon.gallery",
      width: 520,
      height: 420
    });
  }

  function renderGallery(contentEl, ctx, initialCategory) {
    const tabsHtml = CATEGORIES.map((cat) =>
      `<button type="button" class="app-gallery-tab${cat === initialCategory ? " active" : ""}" data-category="${cat}">${cat}</button>`
    ).join("");

    contentEl.innerHTML = `
      <div class="app-gallery">
        <div class="app-gallery-tabs">${tabsHtml}</div>
        <div class="app-gallery-grid"></div>
        <div class="app-gallery-viewer" style="display:none;">
          <button type="button" class="app-gallery-back">&larr; Back to thumbnails</button>
          <div class="app-gallery-viewer-image-wrap">
            <img class="app-gallery-viewer-image" alt="" />
          </div>
          <div class="app-gallery-viewer-caption"></div>
        </div>
      </div>
    `;

    const gridEl = contentEl.querySelector(".app-gallery-grid");
    const viewerEl = contentEl.querySelector(".app-gallery-viewer");
    const viewerImgEl = contentEl.querySelector(".app-gallery-viewer-image");
    const viewerCaptionEl = contentEl.querySelector(".app-gallery-viewer-caption");
    const backBtn = contentEl.querySelector(".app-gallery-back");
    const tabEls = contentEl.querySelectorAll(".app-gallery-tab");

    function renderGrid(category) {
      gridEl.innerHTML = "";
      const items = category === "All" ? GALLERY_ITEMS : GALLERY_ITEMS.filter((i) => i.category === category);
      items.forEach((item) => renderThumb(item));
    }

    tabEls.forEach((tabEl) => {
      tabEl.addEventListener("click", () => {
        tabEls.forEach((t) => t.classList.remove("active"));
        tabEl.classList.add("active");
        renderGrid(tabEl.dataset.category);
      });
    });

    function renderThumb(item) {
      const cell = document.createElement("div");
      cell.className = "app-gallery-thumb";
      cell.dataset.itemId = item.id;

      const thumbImg = document.createElement("img");
      thumbImg.alt = item.caption;
      thumbImg.className = "app-gallery-thumb-img";
      // Graceful fallback: if the real photo file doesn't exist on
      // disk (expected in this project, see header note), fall back
      // to AssetManager's own generic placeholder image rather than
      // showing the browser's broken-image icon.
      thumbImg.addEventListener("error", () => {
        resolveAssetKey(ctx, "image.placeholder", (path) => {
          if (thumbImg.src !== path) thumbImg.src = path;
        });
      }, { once: true });

      const caption = document.createElement("div");
      caption.className = "app-gallery-thumb-caption";
      caption.textContent = item.caption;

      cell.appendChild(thumbImg);
      cell.appendChild(caption);
      cell.addEventListener("click", () => openViewer(item));
      gridEl.appendChild(cell);

      resolveAssetKey(ctx, item.assetKey, (path) => {
        thumbImg.src = path;
      });
    }

    renderGrid(initialCategory);

    backBtn.addEventListener("click", () => {
      viewerEl.style.display = "none";
      gridEl.style.display = "grid";
    });

    function openViewer(item) {
      gridEl.style.display = "none";
      viewerEl.style.display = "flex";
      viewerCaptionEl.textContent = item.caption;

      // Reset any previous error-fallback listener state by cloning
      // the error handling inline here too, since the full-size view
      // is a separate <img> element from the thumbnail.
      viewerImgEl.alt = item.caption;
      viewerImgEl.onerror = () => {
        resolveAssetKey(ctx, "image.placeholder", (path) => {
          if (viewerImgEl.src !== path) viewerImgEl.src = path;
        });
      };

      resolveAssetKey(ctx, item.assetKey, (path) => {
        viewerImgEl.src = path;
      });
    }
  }

  /**
   * Resolve an AssetManager key to a real path via the standard
   * asset:get/asset:resolved request-response pair, same pattern
   * used by WindowManager/DesktopEngine/StartMenuEngine. `ctx.on`/
   * `ctx.emit` are used instead of the raw bus so this app never
   * needs a direct reference to anything beyond its own process
   * context, consistent with the architecture rule that apps only
   * ever talk to the OS through ctx.
   */
  function resolveAssetKey(ctx, key, onResolved) {
    const requestId = `gallery-${key}-${Math.random().toString(36).slice(2)}`;
    const handler = (payload) => {
      if (payload.requestId !== requestId) return;
      unsub();
      onResolved(payload.path);
    };
    const unsub = ctx.on("asset:resolved", handler);
    ctx.emit("asset:get", { key, requestId });
  }
})();
