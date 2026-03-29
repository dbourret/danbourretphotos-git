document.addEventListener("DOMContentLoaded", loadGallery);

async function loadGallery() {
  try {
    const response = await fetch("/data/photos.json");

    if (!response.ok) {
      throw new Error("Could not load photos.json");
    }

    const photos = await response.json();
    const grid = document.getElementById("gallery-grid");

    if (!grid) return;

    grid.innerHTML = photos.map((photo, index) => `
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
              class="btn btn-primary buy-now-btn"
              type="button"
              data-index="${index}"
            >
              Buy Now
            </button>
          </div>
        </div>
      </article>
    `).join("");

    const images = Array.from(grid.querySelectorAll("img"));
    window.App?.registerGallery(images);

    images.forEach((img, index) => {
      if (img.complete) {
        img.classList.add("loaded");
      } else {
        img.addEventListener("load", () => {
          img.classList.add("loaded");
        });
      }

      img.addEventListener("click", () => {
        window.App?.openLightboxByIndex(index);
      });
    });

    document.querySelectorAll(".buy-now-btn").forEach((button) => {
      button.addEventListener("click", () => {
        const photo = photos[Number(button.dataset.index)];
        window.App?.buyNowFromGallery(photo);
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