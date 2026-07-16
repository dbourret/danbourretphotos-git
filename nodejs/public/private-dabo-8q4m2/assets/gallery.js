(() => {
  "use strict";

  const gallery = document.getElementById("gallery");
  const lightbox = document.getElementById("lightbox");
  const lightboxImage = document.getElementById("lightboxImage");
  const lightboxTitle = document.getElementById("lightboxTitle");
  const closeLightbox = document.getElementById("closeLightbox");
  const prevBtn = document.getElementById("prevBtn");
  const nextBtn = document.getElementById("nextBtn");

  if (!gallery || !lightbox || !lightboxImage) {
    return;
  }

  let photos = [];
  let currentIndex = 0;
  let touchStartX = 0;
  let touchStartY = 0;
  let touchStartedWithOneFinger = false;
  let previouslyFocusedElement = null;
  const jsonFile = document.body.dataset.galleryJson || "photos.json";

  function normalizeIndex(index) {
    if (!photos.length) {
      return 0;
    }

    if (index < 0) {
      return photos.length - 1;
    }

    if (index >= photos.length) {
      return 0;
    }

    return index;
  }

  function showPhoto(index) {
    if (!photos.length) {
      return;
    }

    const wasAlreadyOpen = lightbox.classList.contains("open");

    if (!wasAlreadyOpen) {
      previouslyFocusedElement = document.activeElement;
    }

    currentIndex = normalizeIndex(index);
    const photo = photos[currentIndex];
    const fullSizeImage = photo.full || photo.fullImage || photo.image;

    lightboxImage.src = fullSizeImage;
    lightboxImage.alt = photo.alt || photo.title || "Private gallery photograph";
    lightboxTitle.textContent = photo.title || "";
    lightbox.classList.add("open");
    document.body.classList.add("lightbox-open");

    if (!wasAlreadyOpen) {
      closeLightbox.focus({ preventScroll: true });
    }
  }

  function closeViewer() {
    lightbox.classList.remove("open");
    document.body.classList.remove("lightbox-open");
    lightboxImage.src = "";

    if (previouslyFocusedElement && typeof previouslyFocusedElement.focus === "function") {
      previouslyFocusedElement.focus({ preventScroll: true });
    }

    previouslyFocusedElement = null;
  }

  function createPhotoCard(photo, index) {
    const card = document.createElement("article");
    card.className = "photo-card";
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-label", `Open ${photo.title || "photograph"}`);

    const image = document.createElement("img");
    image.src = photo.thumbnail || photo.image;
    image.alt = photo.alt || photo.title || "Private gallery photograph";
    image.loading = "lazy";

    const title = document.createElement("h3");
    title.textContent = photo.title || `Photo ${index + 1}`;

    card.append(image, title);

    card.addEventListener("click", () => showPhoto(index));
    card.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        showPhoto(index);
      }
    });

    return card;
  }

  async function loadGallery() {
    try {
      const response = await fetch(jsonFile, { cache: "no-store" });

      if (!response.ok) {
        throw new Error(`Unable to load ${jsonFile}: ${response.status}`);
      }

      const data = await response.json();

      if (!Array.isArray(data)) {
        throw new Error(`${jsonFile} must contain a JSON array.`);
      }

      photos = data.filter(photo => photo && photo.image);
      gallery.innerHTML = "";

      if (!photos.length) {
        gallery.innerHTML = `
          <p class="empty-message">
            No photographs have been added to this gallery yet.
          </p>
        `;
        return;
      }

      photos.forEach((photo, index) => {
        gallery.appendChild(createPhotoCard(photo, index));
      });
    } catch (error) {
      console.error("Private gallery error:", error);
      gallery.innerHTML = `
        <p class="error-message">
          Could not load this private gallery. Confirm that its photos.json file
          is valid and that the website is being opened through your web server.
        </p>
      `;
    }
  }

  closeLightbox.addEventListener("click", closeViewer);

  prevBtn.addEventListener("click", event => {
    event.stopPropagation();
    showPhoto(currentIndex - 1);
  });

  nextBtn.addEventListener("click", event => {
    event.stopPropagation();
    showPhoto(currentIndex + 1);
  });

  lightbox.addEventListener("click", event => {
    if (event.target === lightbox) {
      closeViewer();
    }
  });

  document.addEventListener("keydown", event => {
    if (!lightbox.classList.contains("open")) {
      return;
    }

    if (event.key === "ArrowRight") {
      showPhoto(currentIndex + 1);
    } else if (event.key === "ArrowLeft") {
      showPhoto(currentIndex - 1);
    } else if (event.key === "Escape") {
      closeViewer();
    }
  });

  lightbox.addEventListener("touchstart", event => {
    touchStartedWithOneFinger = event.touches.length === 1;

    if (!touchStartedWithOneFinger) {
      return;
    }

    touchStartX = event.touches[0].clientX;
    touchStartY = event.touches[0].clientY;
  }, { passive: true });

  lightbox.addEventListener("touchend", event => {
    if (!touchStartedWithOneFinger || event.changedTouches.length !== 1) {
      touchStartedWithOneFinger = false;
      return;
    }

    const touchEndX = event.changedTouches[0].clientX;
    const touchEndY = event.changedTouches[0].clientY;
    const horizontalDistance = touchEndX - touchStartX;
    const verticalDistance = touchEndY - touchStartY;

    touchStartedWithOneFinger = false;

    if (
      Math.abs(horizontalDistance) < 55 ||
      Math.abs(horizontalDistance) <= Math.abs(verticalDistance)
    ) {
      return;
    }

    if (horizontalDistance < 0) {
      showPhoto(currentIndex + 1);
    } else {
      showPhoto(currentIndex - 1);
    }
  }, { passive: true });

  loadGallery();
})();
