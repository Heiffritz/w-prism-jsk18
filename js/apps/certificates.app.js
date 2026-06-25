/**
 * certificates.app.js
 * ------------------------------------------------------------------
 * The "Certificates" app — a list of certificate documents, each
 * viewable inline via an <iframe> (the standard way a browser embeds
 * a PDF without any extra library) and downloadable via a real
 * anchor `download` attribute.
 *
 * Same registration/factory/window pattern as every other app (see
 * about.app.js for the full architecture note). Every PDF is
 * referenced by an AssetManager KEY, resolved via asset:get/
 * asset:resolved — never a hardcoded path.
 *
 * HONESTLY STATED, same as gallery.app.js: the actual .pdf binary
 * files referenced here do not exist on disk in this project. The
 * asset keys ARE registered in data/assets.json and DO resolve to
 * real path strings; the iframe will correctly attempt to load that
 * path, and since this is a plain static project with no real PDF
 * files shipped, the browser will show its own "file not found" or
 * blank state inside the iframe. That is expected for this phase —
 * supplying real certificate PDFs is a deployment-time content task,
 * not something this app's logic is responsible for.
 * ------------------------------------------------------------------
 */

(function registerCertificatesApp() {
  const APP_ID = "certificates";

  const CERTIFICATES = [
    { id: "c1", assetKey: "pdf.certificate_sample", title: "Sample Certificate" },
    { id: "c2", assetKey: "pdf.certificate_course", title: "Course Completion Certificate" }
  ];

  window.eventBus.on("kernel:ready", () => {
    window.eventBus.emit("process:registerApp", {
      appId: APP_ID,
      title: "Certificates",
      icon: "icon.certificates",
      singleInstance: true,
      factory: certificatesAppFactory
    });
  });

  function certificatesAppFactory(ctx) {
    const unsubscribe = ctx.on("window:created", (payload) => {
      if (payload.pid !== ctx.pid) return;
      unsubscribe();
      ctx.setWindowId(payload.windowId);
      renderCertificates(payload.contentEl, ctx);
    });

    ctx.emit("window:create", {
      title: "Certificates",
      icon: "icon.certificates",
      width: 560,
      height: 440
    });
  }

  function renderCertificates(contentEl, ctx) {
    contentEl.innerHTML = `
      <div class="app-certificates">
        <div class="app-certificates-list"></div>
        <div class="app-certificates-viewer">
          <div class="app-certificates-toolbar" style="display:none;">
            <span class="app-certificates-current-title"></span>
            <a class="app-certificates-download" download>Download</a>
          </div>
          <div class="app-certificates-frame-wrap">
            <div class="app-certificates-empty">Select a certificate from the list to preview it.</div>
            <iframe class="app-certificates-frame" style="display:none;" title="Certificate preview"></iframe>
          </div>
        </div>
      </div>
    `;

    const listEl = contentEl.querySelector(".app-certificates-list");
    const toolbarEl = contentEl.querySelector(".app-certificates-toolbar");
    const titleEl = contentEl.querySelector(".app-certificates-current-title");
    const downloadEl = contentEl.querySelector(".app-certificates-download");
    const emptyEl = contentEl.querySelector(".app-certificates-empty");
    const frameEl = contentEl.querySelector(".app-certificates-frame");

    CERTIFICATES.forEach((cert) => {
      const item = document.createElement("div");
      item.className = "app-certificates-list-item";
      item.dataset.certId = cert.id;
      item.textContent = cert.title;

      item.addEventListener("click", () => {
        listEl.querySelectorAll(".app-certificates-list-item.selected").forEach((el) => {
          el.classList.remove("selected");
        });
        item.classList.add("selected");
        openCertificate(cert);
      });

      listEl.appendChild(item);
    });

    function openCertificate(cert) {
      resolveAssetKey(ctx, cert.assetKey, (path) => {
        emptyEl.style.display = "none";
        frameEl.style.display = "block";
        frameEl.src = path;

        toolbarEl.style.display = "flex";
        titleEl.textContent = cert.title;

        // Real file download: the browser's `download` attribute on
        // an <a> tells it to save the linked resource instead of
        // navigating to it. This is a genuine download mechanism,
        // not a simulation — it will actually save whatever file
        // exists at `path` once real certificate PDFs are deployed.
        downloadEl.href = path;
        downloadEl.setAttribute("download", `${cert.title.replace(/\s+/g, "_")}.pdf`);
      });
    }
  }

  /**
   * Same asset-resolution helper pattern as gallery.app.js — resolves
   * an AssetManager key via ctx.on/ctx.emit only, never reaching for
   * a direct AssetManager reference.
   */
  function resolveAssetKey(ctx, key, onResolved) {
    const requestId = `certificates-${key}-${Math.random().toString(36).slice(2)}`;
    const handler = (payload) => {
      if (payload.requestId !== requestId) return;
      unsub();
      onResolved(payload.path);
    };
    const unsub = ctx.on("asset:resolved", handler);
    ctx.emit("asset:get", { key, requestId });
  }
})();
