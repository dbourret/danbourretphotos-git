const toggle = document.querySelector(".nav-toggle");
const nav = document.querySelector("#site-nav");
if (toggle && nav) {
  toggle.addEventListener("click", () => {
    let expanded = toggle.getAttribute("aria-expanded") === "true";
    toggle.setAttribute("aria-expanded", String(!expanded));
    nav.classList.toggle("open", !expanded);
  });
  nav.querySelectorAll("a").forEach((a) =>
    a.addEventListener("click", () => {
      nav.classList.remove("open");
      toggle.setAttribute("aria-expanded", "false");
    }),
  );
}

// Accessible photo viewer: all images in each chapter open at their native stored size.
(() => {
  const photos = Array.from(document.querySelectorAll("main img")).filter(
    (img) => img.getAttribute("src"),
  );
  if (!photos.length) return;
  let active = -1;
  let previousFocus = null;
  const viewer = document.createElement("div");
  viewer.className = "photo-lightbox";
  viewer.setAttribute("role", "dialog");
  viewer.setAttribute("aria-modal", "true");
  viewer.setAttribute("aria-label", "Enlarged photo viewer");
  viewer.hidden = true;
  viewer.innerHTML = `
    <div class="photo-lightbox__screen" data-close="true"></div>
    <div class="photo-lightbox__shell">
      <button type="button" class="photo-lightbox__close" aria-label="Close enlarged photo">×</button>
      <button type="button" class="photo-lightbox__prev" aria-label="Previous photo">‹</button>
      <figure class="photo-lightbox__figure">
        <img class="photo-lightbox__image" alt="">
        <figcaption class="photo-lightbox__caption" aria-live="polite"></figcaption>
      </figure>
      <button type="button" class="photo-lightbox__next" aria-label="Next photo">›</button>
    </div>`;
  document.body.appendChild(viewer);
  const image = viewer.querySelector(".photo-lightbox__image");
  const caption = viewer.querySelector(".photo-lightbox__caption");
  const close = viewer.querySelector(".photo-lightbox__close");
  const prev = viewer.querySelector(".photo-lightbox__prev");
  const next = viewer.querySelector(".photo-lightbox__next");
  const titleFor = (img) =>
    img.closest("figure")?.querySelector("figcaption")?.textContent.trim() ||
    img.alt ||
    "Photo";
  function show(index) {
    active = (index + photos.length) % photos.length;
    const source = photos[active];
    image.src = source.currentSrc || source.src;
    image.alt = source.alt || "Enlarged photograph";
    caption.textContent = `${titleFor(source)} · ${active + 1} of ${photos.length}`;
    prev.hidden = next.hidden = photos.length < 2;
  }
  function open(index) {
    previousFocus = document.activeElement;
    viewer.hidden = false;
    document.body.classList.add("photo-lightbox-open");
    show(index);
    close.focus();
  }
  function hide() {
    viewer.hidden = true;
    image.removeAttribute("src");
    document.body.classList.remove("photo-lightbox-open");
    if (previousFocus?.focus) previousFocus.focus();
  }
  photos.forEach((img, index) => {
    img.classList.add("zoomable-photo");
    img.setAttribute("tabindex", "0");
    img.setAttribute("role", "button");
    img.setAttribute("aria-label", `View larger photo: ${titleFor(img)}`);
    img.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      open(index);
    });
    img.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        event.stopPropagation();
        open(index);
      }
    });
  });
  close.addEventListener("click", hide);
  viewer.querySelector("[data-close]").addEventListener("click", hide);
  prev.addEventListener("click", () => show(active - 1));
  next.addEventListener("click", () => show(active + 1));
  document.addEventListener("keydown", (event) => {
    if (viewer.hidden) return;
    if (event.key === "Escape") {
      event.preventDefault();
      hide();
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      show(active - 1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      show(active + 1);
    } else if (event.key === "Tab") {
      const buttons = [close, prev, next].filter((b) => !b.hidden);
      const first = buttons[0],
        last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  });
})();
