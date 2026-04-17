document.addEventListener("DOMContentLoaded", loadGallery);

let allPhotos = [];
let activeFilter = "all";

async function loadGallery() {
  try {
    const response = await fetch("data/photos.json");

    if (!response.ok) {
      throw new Error("Could not load photos.json");
    }

    const photos = await response.json();
    allPhotos = photos;
    window.galleryPhotos = photos;

    bindGalleryFilters();
    renderGallery();
  } catch (error) {
    console.error("Gallery load error:", error);

    const grid = document.getElementById("gallery-grid");
    if (grid) {
      grid.innerHTML = `
        <p class="muted">
          Could not load gallery. Make sure you're running the site from your server.
        </p>
      `;
    }
  }
}

function bindGalleryFilters() {
  const filterWrap = document.getElementById("gallery-filters");
  if (!filterWrap) return;

  const buttons = Array.from(filterWrap.querySelectorAll("[data-filter]"));

  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      activeFilter = button.dataset.filter || "all";

      buttons.forEach((btn) => btn.classList.remove("active"));
      button.classList.add("active");

      renderGallery();
    });
  });
}

function renderGallery() {
  const grid = document.getElementById("gallery-grid");
  if (!grid) return;

  const filteredPhotos =
    activeFilter === "all"
      ? allPhotos
      : allPhotos.filter(
          (photo) => (photo.category || "").toLowerCase() === activeFilter,
        );

  if (!filteredPhotos.length) {
    grid.innerHTML = `
      <p class="muted">No images found in this category.</p>
    `;
    return;
  }

  grid.innerHTML = filteredPhotos
    .map((photo) => {
      const originalIndex = allPhotos.findIndex((p) => p.src === photo.src);

      return `
        <article class="image-card gallery-card">
          <img
            src="${photo.src}"
            alt="${photo.alt || photo.title || "Photo"}"
            data-caption="${photo.description || ""}"
            data-index="${originalIndex}"
            loading="lazy"
          />

          <div class="gallery-content">
            <span class="tag">${formatCategory(photo.category || "Gallery")}</span>
            <h3>${photo.title || "Untitled"}</h3>
            <p class="muted">${photo.description || "Premium print available in multiple formats and sizes."}</p>

            <div class="meta-row">
              <button
                class="btn btn-primary add-to-cart-btn"
                type="button"
                onclick="window.handlePhotoPurchase(${originalIndex}); return false;"
              >
                Choose Print Options
              </button>
            </div>
          </div>
        </article>
      `;
    })
    .join("");

  const images = Array.from(grid.querySelectorAll("img"));

  if (window.App && typeof window.App.registerGallery === "function") {
    window.App.registerGallery(images);
  }

  images.forEach((img) => {
    img.addEventListener("click", () => {
      const index = Number(img.dataset.index);
      if (window.App && typeof window.App.openLightboxByIndex === "function") {
        window.App.openLightboxByIndex(index);
      }
    });
  });
}

function formatCategory(category) {
  const normalized = String(category || "").toLowerCase();

  if (normalized === "birds") return "Birds";
  if (normalized === "animals") return "Animals";
  if (normalized === "flowers") return "Flowers";
  if (normalized === "misc") return "Scenic / Misc";

  return category;
}

window.handlePhotoPurchase = function (index) {
  if (typeof window.addPhotoToCartByIndex === "function") {
    window.addPhotoToCartByIndex(index);
    return;
  }

  alert("No purchase flow is currently connected for this photo.");
};
