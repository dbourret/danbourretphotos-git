(() => {
  "use strict";

  const gallery = document.getElementById("restorationGallery");
  const count = document.getElementById("galleryCount");
  const lightbox = document.getElementById("lightbox");
  const lightboxImage = document.getElementById("lightboxImage");
  const lightboxTitle = document.getElementById("lightboxTitle");
  const lightboxFilename = document.getElementById("lightboxFilename");
  const lightboxCounter = document.getElementById("lightboxCounter");
  const previousButton = lightbox.querySelector(".lightbox-prev");
  const nextButton = lightbox.querySelector(".lightbox-next");

  let allImages = [];
  let currentIndex = 0;
  let lastFocusedElement = null;
  let touchStartX = 0;

  const makeElement = (tag, className, text) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  };

  const renderGallery = (groups) => {
    const fragment = document.createDocumentFragment();
    allImages = [];

    groups.forEach((group) => {
      const section = makeElement("article", "restoration-group");
      section.id = `restoration-${group.position}`;

      const header = makeElement("div", "restoration-group-header");
      header.append(
        makeElement("h3", "", group.title),
        makeElement("span", "restoration-group-key", group.group)
      );

      const row = makeElement("div", "restoration-row");

      group.items.forEach((item) => {
        const imageIndex = allImages.length;
        allImages.push({ ...item, groupTitle: group.title, groupKey: group.group });

        const button = makeElement("button", "restoration-tile");
        button.type = "button";
        button.dataset.imageIndex = String(imageIndex);
        button.setAttribute("aria-label", `Open ${group.title}, ${item.label}`);

        const frame = makeElement("span", "restoration-image-frame");
        const image = document.createElement("img");
        image.src = item.thumbnail;
        image.alt = `${group.title} — ${item.label}`;
        image.loading = "lazy";
        image.decoding = "async";
        frame.append(image);

        button.append(
          frame,
          makeElement("span", "restoration-label", item.label),
          makeElement("span", "restoration-filename", item.filename)
        );
        row.append(button);
      });

      section.append(header, row);
      fragment.append(section);
    });

    gallery.replaceChildren(fragment);
    count.textContent = `${groups.length} restoration groups · ${allImages.length} images`;
  };

  const updateLightbox = () => {
    const item = allImages[currentIndex];
    if (!item) return;

    lightboxImage.src = item.image;
    lightboxImage.alt = `${item.groupTitle} — ${item.label}`;
    lightboxTitle.textContent = `${item.groupTitle} · ${item.label}`;
    lightboxFilename.textContent = item.filename;
    lightboxCounter.textContent = `Image ${currentIndex + 1} of ${allImages.length}`;
  };

  const openLightbox = (index, trigger) => {
    currentIndex = index;
    lastFocusedElement = trigger || document.activeElement;
    updateLightbox();
    lightbox.hidden = false;
    lightbox.setAttribute("aria-hidden", "false");
    document.body.classList.add("lightbox-open");
    lightbox.querySelector(".lightbox-close").focus();
  };

  const closeLightbox = () => {
    lightbox.hidden = true;
    lightbox.setAttribute("aria-hidden", "true");
    lightboxImage.removeAttribute("src");
    document.body.classList.remove("lightbox-open");
    if (lastFocusedElement && typeof lastFocusedElement.focus === "function") {
      lastFocusedElement.focus();
    }
  };

  const showPrevious = () => {
    currentIndex = (currentIndex - 1 + allImages.length) % allImages.length;
    updateLightbox();
  };

  const showNext = () => {
    currentIndex = (currentIndex + 1) % allImages.length;
    updateLightbox();
  };

  gallery.addEventListener("click", (event) => {
    const tile = event.target.closest(".restoration-tile");
    if (!tile) return;
    openLightbox(Number(tile.dataset.imageIndex), tile);
  });

  previousButton.addEventListener("click", showPrevious);
  nextButton.addEventListener("click", showNext);
  lightbox.querySelectorAll("[data-close-lightbox]").forEach((element) => {
    element.addEventListener("click", closeLightbox);
  });

  document.addEventListener("keydown", (event) => {
    if (lightbox.hidden) return;
    if (event.key === "Escape") closeLightbox();
    if (event.key === "ArrowLeft") showPrevious();
    if (event.key === "ArrowRight") showNext();
  });

  lightbox.addEventListener("touchstart", (event) => {
    touchStartX = event.changedTouches[0].clientX;
  }, { passive: true });

  lightbox.addEventListener("touchend", (event) => {
    const difference = event.changedTouches[0].clientX - touchStartX;
    if (Math.abs(difference) < 45) return;
    difference > 0 ? showPrevious() : showNext();
  }, { passive: true });

  fetch("photos.json", { cache: "no-store" })
    .then((response) => {
      if (!response.ok) throw new Error(`Gallery data request failed: ${response.status}`);
      return response.json();
    })
    .then(renderGallery)
    .catch((error) => {
      console.error(error);
      count.textContent = "Gallery could not be loaded.";
      gallery.innerHTML = '<p class="gallery-error">The restoration gallery data could not be loaded. Confirm that photos.json and the image folders were uploaded with this page.</p>';
    });
})();
