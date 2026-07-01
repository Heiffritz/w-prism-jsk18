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
      tags: ["JavaScript", "Architecture", "Event-driven"],
      galleryCategory: null
    },
    {
      id: "warm-soup",
      title: "Warm Soup",
      blurb: "Warm Soup is a point-and-click narrative psychological horror game that follows a child simply wishing to return home for a warm bowl of soup, while the world around him slowly unravels. Featuring realistic photography layered with retro-inspired dithering effects, the game blends nostalgic visuals with unsettling storytelling to create an eerie, emotionally driven experience.",
      tags: ["Game Project", "Artist", "Game Design", "Godot"],
      galleryCategory: "Game Projects"
    },
    {
      id: "3d-models",
      title: "3D Models",
      blurb: "A collection of custom 3D models created primarily for Minecraft-related projects, ranging from blocks, items, and entities to other game-ready assets. The gallery continues to grow over time, so be sure to check out the 3D Models section to explore my latest creations.",
      tags: ["3D Model", "Personal Project", "Commission", "Pixel Art", "Low-Poly"],
      galleryCategory: "3D Models"
    },
    {
      id: "untitled-game-project",
      title: "Untitled Game Project (Heavy WIP)",
      blurb: "An experimental game currently in heavy development, centered around a combat system that rewards calculated aggression over passive defense. Instead of relying solely on dodging, players build momentum through precise attacks and well-timed decisions, creating opportunities to break through an opponent's defenses. The project is still undergoing significant iteration, with mechanics, visuals, and overall gameplay actively evolving.",
      tags: ["Personal Project", "Game Project", "Game Design", "Pixel Art", "Low-Poly"],
      galleryCategory: "Game Projects"
    },
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
      renderProjects(payload.contentEl, ctx);
    });

    ctx.emit("window:create", {
      title: "Projects",
      icon: "icon.projects",
      width: 560,
      height: 400
    });
  }

  function renderProjects(contentEl, ctx) {
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
        renderDetail(detailEl, project, ctx);
      });

      listEl.appendChild(item);
    });

    // Auto-select the first project so the detail pane isn't empty
    // on first open.
    if (PROJECTS.length > 0) {
      listEl.firstElementChild.click();
    }
  }

  function renderDetail(detailEl, project, ctx) {
    const tagsHtml = project.tags
      .map((tag) => `<span class="app-projects-tag">${escapeHtml(tag)}</span>`)
      .join("");

    // Suggestion #19: "View Gallery" button, shown only for projects
    // that map to a real Gallery category. Spawns Gallery with that
    // category pre-selected via spawn args.
    const galleryBtnHtml = project.galleryCategory
      ? `<button type="button" class="app-projects-gallery-btn" data-category="${escapeHtml(project.galleryCategory)}">View Gallery</button>`
      : "";

    detailEl.innerHTML = `
      <h3 class="app-projects-detail-title">${escapeHtml(project.title)}</h3>
      <p class="app-projects-detail-blurb">${escapeHtml(project.blurb)}</p>
      <div class="app-projects-tags">${tagsHtml}</div>
      ${galleryBtnHtml}
    `;

    const galleryBtn = detailEl.querySelector(".app-projects-gallery-btn");
    if (galleryBtn) {
      galleryBtn.addEventListener("click", () => {
        ctx.emit("process:spawn", { appId: "gallery", args: { category: project.galleryCategory } });
        ctx.emit("gallery:setCategory", { category: project.galleryCategory });
      });
    }
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
