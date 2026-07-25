(() => {
  const menus = document.querySelectorAll("[data-private-gallery-menu]");
  if (!menus.length) return;

  const rootUrl = new URL("../", window.location.href);

  function normalizePath(url) {
    const pathname = new URL(url, window.location.href).pathname;
    return pathname.replace(/\/index\.html$/i, "/").replace(/\/+$/, "/");
  }

  function fallbackGalleries() {
    return [
      { name: "Sports", href: new URL("sports/", rootUrl).href },
      { name: "Cars", href: new URL("cars/", rootUrl).href },
      { name: "Restorations", href: new URL("restorations/", rootUrl).href },
    ];
  }

  async function loadGalleries() {
    try {
      const response = await fetch(rootUrl.href, {
        cache: "no-store",
        credentials: "same-origin",
      });

      if (!response.ok) {
        throw new Error(`Private home returned ${response.status}`);
      }

      const html = await response.text();
      const documentCopy = new DOMParser().parseFromString(html, "text/html");

      const galleries = [...documentCopy.querySelectorAll(".category-card[href]")]
        .map((card) => {
          const name =
            card.querySelector(".category-name")?.textContent?.trim() ||
            card.textContent?.trim() ||
            "";

          const href = card.getAttribute("href") || "";

          return {
            name,
            href: new URL(href, rootUrl).href,
          };
        })
        .filter((gallery) => gallery.name && gallery.href);

      return galleries.length ? galleries : fallbackGalleries();
    } catch (error) {
      console.warn("Could not build the private gallery menu dynamically:", error);
      return fallbackGalleries();
    }
  }

  function renderMenu(dropdown, galleries) {
    const currentPath = normalizePath(window.location.href);
    const list = document.createElement("ul");
    list.className = "private-menu-list";

    galleries.forEach((gallery) => {
      const item = document.createElement("li");
      const link = document.createElement("a");

      link.href = gallery.href;
      link.textContent = gallery.name;

      if (normalizePath(gallery.href) === currentPath) {
        link.setAttribute("aria-current", "page");
      }

      item.appendChild(link);
      list.appendChild(item);
    });

    dropdown.replaceChildren(list);
  }

  function closeAllMenus(except = null) {
    menus.forEach((menu) => {
      if (menu === except) return;

      const button = menu.querySelector(".private-menu-toggle");
      const dropdown = menu.querySelector(".private-menu-dropdown");

      if (!button || !dropdown) return;

      button.setAttribute("aria-expanded", "false");
      dropdown.hidden = true;
    });
  }

  loadGalleries().then((galleries) => {
    menus.forEach((menu) => {
      const button = menu.querySelector(".private-menu-toggle");
      const dropdown = menu.querySelector(".private-menu-dropdown");

      if (!button || !dropdown) return;

      renderMenu(dropdown, galleries);

      button.addEventListener("click", (event) => {
        event.stopPropagation();

        const isOpen = button.getAttribute("aria-expanded") === "true";
        closeAllMenus(menu);

        button.setAttribute("aria-expanded", String(!isOpen));
        dropdown.hidden = isOpen;
      });

      dropdown.addEventListener("click", (event) => {
        event.stopPropagation();
      });
    });
  });

  document.addEventListener("click", () => closeAllMenus());

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeAllMenus();
      document.querySelector(".private-menu-toggle[aria-expanded='true']")?.focus();
    }
  });
})();
