(() => {
  "use strict";

  const gallery = document.getElementById("restorationGallery");
  const lightbox = document.getElementById("lightbox");

  if (!gallery || !lightbox) {
    return;
  }

  let fullscreenStartedHere = false;
  let fullscreenRequestPending = false;

  const explicitCaptionSelectors = [
    "figcaption",
    ".restoration-caption",
    ".restoration-photo-caption",
    ".restoration-image-caption",
    ".photo-caption",
    ".image-caption",
    ".photo-description",
    ".image-description",
    ".photo-filename",
    ".image-filename",
    ".restoration-filename",
    ".restoration-label",
    ".photo-label",
    ".image-label",
    ".magnifier",
    ".magnifying-glass",
    ".zoom-icon",
    ".zoom-overlay",
    ".zoom-hint",
    ".view-icon",
    ".view-overlay",
    ".click-hint",
    '[class*="magnif" i]',
    '[class*="zoom-icon" i]',
    '[class*="zoom-hint" i]',
    '[class*="click-hint" i]',
  ].join(",");

  const visiblePromptPattern =
    /^(?:🔍|🔎|magnify|magnifying glass|zoom|view|view photo|view image|click(?: here)?(?: to)? (?:view|open|enlarge)|open full(?:-| )?screen|original(?: jpg)?|restored(?: png| b&w)?|combined)$/i;

  function elementContainsGalleryImage(element) {
    return Boolean(element && element.querySelector && element.querySelector("img"));
  }

  function removeExplicitCaptionElements(root = gallery) {
    root.querySelectorAll(explicitCaptionSelectors).forEach((element) => {
      if (element.closest("#lightbox")) {
        return;
      }

      element.remove();
    });
  }

  function removeLooseTextUnderImages(root = gallery) {
    root.querySelectorAll("img").forEach((image) => {
      const wrapper = image.closest(
        "figure, button, a, [data-lightbox-index], [data-photo-index], " +
          ".restoration-photo, .restoration-item, .restoration-image, " +
          ".restoration-card, .photo-card, .image-card"
      );

      if (!wrapper || wrapper === gallery) {
        return;
      }

      wrapper.removeAttribute("title");

      Array.from(wrapper.children).forEach((child) => {
        if (
          child === image ||
          child.tagName === "PICTURE" ||
          child.tagName === "SOURCE" ||
          child.contains(image)
        ) {
          return;
        }

        const text = (child.textContent || "").replace(/\s+/g, " ").trim();

        if (
          child.matches("figcaption, p, small, label") ||
          child.className?.toString().match(
            /caption|description|filename|photo-label|image-label|zoom|magnif|click-hint/i
          ) ||
          visiblePromptPattern.test(text)
        ) {
          child.remove();
        }
      });

      wrapper.querySelectorAll("[title]").forEach((element) => {
        if (/click|open|view|zoom|magnif/i.test(element.getAttribute("title") || "")) {
          element.removeAttribute("title");
        }
      });

      wrapper.querySelectorAll("[aria-label]").forEach((element) => {
        const label = element.getAttribute("aria-label") || "";

        if (/magnif|zoom/i.test(label)) {
          element.remove();
        }
      });
    });
  }

  function removeVisiblePromptText(root = gallery) {
    root.querySelectorAll("span, div, p, small").forEach((element) => {
      if (elementContainsGalleryImage(element)) {
        return;
      }

      const text = (element.textContent || "").replace(/\s+/g, " ").trim();

      if (text && visiblePromptPattern.test(text)) {
        element.remove();
      }
    });
  }

  function cleanGalleryCards(root = gallery) {
    removeExplicitCaptionElements(root);
    removeLooseTextUnderImages(root);
    removeVisiblePromptText(root);
  }

  function lightboxIsOpen() {
    if (lightbox.hidden) {
      return false;
    }

    if (lightbox.getAttribute("aria-hidden") === "false") {
      return true;
    }

    return (
      lightbox.classList.contains("open") ||
      lightbox.classList.contains("is-open") ||
      getComputedStyle(lightbox).display !== "none"
    );
  }

  async function requestRealFullscreen() {
    if (!lightboxIsOpen() || document.fullscreenElement || fullscreenRequestPending) {
      return;
    }

    const request =
      lightbox.requestFullscreen?.bind(lightbox) ||
      lightbox.webkitRequestFullscreen?.bind(lightbox);

    if (!request) {
      return;
    }

    fullscreenRequestPending = true;

    try {
      await request();
      fullscreenStartedHere = true;
    } catch (error) {
      // The CSS still gives a complete full-viewport viewer when a browser
      // blocks the Fullscreen API or does not support it.
      console.debug("Native fullscreen was unavailable; using viewport fullscreen.", error);
    } finally {
      fullscreenRequestPending = false;
    }
  }

  async function exitRealFullscreen() {
    const exit =
      document.exitFullscreen?.bind(document) ||
      document.webkitExitFullscreen?.bind(document);

    if (!exit || !document.fullscreenElement) {
      fullscreenStartedHere = false;
      return;
    }

    try {
      await exit();
    } catch (error) {
      console.debug("Could not exit native fullscreen.", error);
    } finally {
      fullscreenStartedHere = false;
    }
  }

  function closeLightboxFromFullscreenExit() {
    if (!fullscreenStartedHere || document.fullscreenElement || !lightboxIsOpen()) {
      return;
    }

    fullscreenStartedHere = false;

    const closeButton = lightbox.querySelector(
      "[data-close-lightbox], .lightbox-close, #closeLightbox"
    );

    closeButton?.click();
  }

  /*
   * Queue the fullscreen request from the same user click that opens the
   * existing viewer. The current restorations.js remains responsible for
   * choosing the correct image and handling next/previous navigation.
   */
  gallery.addEventListener(
    "click",
    (event) => {
      const clickedPhoto = event.target.closest(
        "img, figure, button, [data-lightbox-index], [data-photo-index], " +
          ".restoration-photo, .restoration-item, .restoration-image, .restoration-card"
      );

      if (!clickedPhoto || !gallery.contains(clickedPhoto)) {
        return;
      }

      queueMicrotask(() => {
        requestRealFullscreen();
      });
    },
    true
  );

  lightbox.addEventListener(
    "click",
    (event) => {
      if (
        event.target.closest(
          "[data-close-lightbox], .lightbox-close, #closeLightbox"
        )
      ) {
        exitRealFullscreen();
      }
    },
    true
  );

  document.addEventListener("fullscreenchange", closeLightboxFromFullscreenExit);
  document.addEventListener(
    "webkitfullscreenchange",
    closeLightboxFromFullscreenExit
  );

  const galleryObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          cleanGalleryCards(node);
        }
      });
    }

    cleanGalleryCards();
  });

  galleryObserver.observe(gallery, {
    childList: true,
    subtree: true,
  });

  const lightboxObserver = new MutationObserver(() => {
    if (lightboxIsOpen()) {
      document.documentElement.classList.add("restoration-lightbox-open");
      document.body.classList.add("restoration-lightbox-open");
    } else {
      document.documentElement.classList.remove("restoration-lightbox-open");
      document.body.classList.remove("restoration-lightbox-open");
    }
  });

  lightboxObserver.observe(lightbox, {
    attributes: true,
    attributeFilter: ["hidden", "aria-hidden", "class", "style"],
  });

  cleanGalleryCards();
})();
