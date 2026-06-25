/**
 * projects.app.js
 * ------------------------------------------------------------------
 * The "Projects" portfolio app — a simple master/detail list of
 * portfolio projects. Same registration/factory/window pattern as
 * every other app (see about.app.js for the full architecture note).
 *
 * Project data is defined inline as a small static array for now.
 * A later phase's Explorer/VFS integration could source this from
 * data/vfs.json instead, but that's intentionally out of scope here —
 * Phase 5's job is the APP SYSTEM itself, not data modeling.
 * ------------------------------------------------------------------
 */

(function registerProjectsApp() {
  const APP_ID = "projects";

  const PROJECTS = [
    {
      id: "prism-os",
      title: "Windows Prism JSK",
      blurb: "A browser-based OS simulation engine — the very portfolio you're using right now.",
      tags: ["JavaScript", "Architecture", "Event-driven"]
    },
    {
      id: "project-two",
      title: "Project Two",
      blurb: "Describe a second project here — what it does, what problem it solves.",
      tags: ["Tag A", "Tag B"]
    },
    {
      id: "project-three",
      title: "Project Three",
      blurb: "Describe a third project here — link out, add screenshots, whatever fits.",
      tags: ["Tag C", "Tag D"]
    }
  ];

  // See about.app.js for why registration must wait for
  // "kernel:ready" rather than firing immediately at script-load time.
  window.eventBus.on("kernel:ready", () => {
    window.eventBus.emit("process:registerApp", {
      appId: APP_ID,
      title: "Projects",
      icon: "icon.projects",
      singleInstance: true,
      factory: projectsAppFactory
    });
  });

  function projectsAppFactory(ctx) {
    const unsubscribe = ctx.on("window:created", (payload) => {
      if (payload.pid !== ctx.pid) return;
      unsubscribe();
      ctx.setWindowId(payload.windowId);
      renderProjects(payload.contentEl);
    });

    ctx.emit("window:create", {
      title: "Projects",
      icon: "icon.projects",
      width: 560,
      height: 400
    });
  }

  function renderProjects(contentEl) {
    contentEl.innerHTML = `
      <div class="app-projects">
        <div class="app-projects-list"></div>
        <div class="app-projects-detail">
          <div class="app-projects-detail-empty">Select a project from the list.</div>
        </div>
      </div>
    `;

    const listEl = contentEl.querySelector(".app-projects-list");
    const detailEl = contentEl.querySelector(".app-projects-detail");

    PROJECTS.forEach((project) => {
      const item = document.createElement("div");
      item.className = "app-projects-list-item";
      item.dataset.projectId = project.id;
      item.textContent = project.title;

      item.addEventListener("click", () => {
        // Clear selection styling from any previously-selected item,
        // then mark this one. All scoped to contentEl's own subtree —
        // never touches anything outside this app's window.
        listEl.querySelectorAll(".app-projects-list-item.selected").forEach((el) => {
          el.classList.remove("selected");
        });
        item.classList.add("selected");
        renderDetail(detailEl, project);
      });

      listEl.appendChild(item);
    });

    // Auto-select the first project so the detail pane isn't empty
    // on first open.
    if (PROJECTS.length > 0) {
      listEl.firstElementChild.click();
    }
  }

  function renderDetail(detailEl, project) {
    const tagsHtml = project.tags
      .map((tag) => `<span class="app-projects-tag">${escapeHtml(tag)}</span>`)
      .join("");

    detailEl.innerHTML = `
      <h3 class="app-projects-detail-title">${escapeHtml(project.title)}</h3>
      <p class="app-projects-detail-blurb">${escapeHtml(project.blurb)}</p>
      <div class="app-projects-tags">${tagsHtml}</div>
    `;
  }

  /**
   * Minimal HTML-escaping so project data (even though it's
   * hardcoded today) doesn't get treated as markup if this app is
   * later wired up to user-editable or VFS-sourced content.
   */
  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }
})();
