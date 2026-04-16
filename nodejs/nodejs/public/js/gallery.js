document.addEventListener("DOMContentLoaded", loadGallery);

async function loadGallery() {
  try {
    const response = await fetch("data/photos.json");

    if (!response.ok) {
      throw new Error("Could not load photos.json");
    }

    const photos = await response.json();
    window.galleryPhotos = photos;

    const grid = document.getElementById("gallery-grid");
    if (!grid) return;

    grid.innerHTML = photos
      .map(
        (photo, index) => `
      <article class="image-card gallery-card">
        <img
          src="${photo.src}"
          alt="${photo.alt || photo.title || "Photo"}"
          data-caption="${photo.description || ""}"
          data-index="${index}"
          loading="lazy"
        />

        <div class="gallery-content">
          <span class="tag">${photo.category || "Gallery"}</span>
          <h3>${photo.title || "Untitled"}</h3>
          <p class="muted">${photo.description || ""}</p>

          <div class="meta-row">
            <button
              class="btn btn-primary add-to-cart-btn"
              type="button"
              onclick="window.addPhotoToCartByIndex(${index}); return false;"
            >
              Add To Cart
            </button>
          </div>
        </div>
      </article>
    `,
      )
      .join("");

    const images = Array.from(grid.querySelectorAll("img"));

    if (window.App && typeof window.App.registerGallery === "function") {
      window.App.registerGallery(images);
    }

    images.forEach((img) => {
      img.addEventListener("click", () => {
        const index = Number(img.dataset.index);
        if (
          window.App &&
          typeof window.App.openLightboxByIndex === "function"
        ) {
          window.App.openLightboxByIndex(index);
        }
      });
    });
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
