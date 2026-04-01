console.log("main.js loaded");

/* =============================
   PAGE NAVIGATION
============================= */

function showPage(pageName) {
  document.querySelectorAll(".page").forEach((page) => {
    page.classList.remove("active");
  });

  const page = document.getElementById(`page-${pageName}`);
  if (page) {
    page.classList.add("active");
  }

  if (pageName === "order") {
    setTimeout(() => {
      initSquare().catch((err) => {
        console.error("Square init error:", err);
      });
    }, 200);
  }

  history.replaceState({}, "", window.location.pathname);
}

function bindPageNavigation() {
  document.querySelectorAll("[data-page]").forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      showPage(link.dataset.page);
    });
  });

  document.querySelectorAll("[data-page-target]").forEach((btn) => {
    btn.addEventListener("click", () => {
      showPage(btn.dataset.pageTarget);
    });
  });
}

/* =============================
   CART
============================= */

function getCart() {
  return JSON.parse(localStorage.getItem("cart") || "[]");
}

function saveCart(cart) {
  localStorage.setItem("cart", JSON.stringify(cart));
}

function getPrice(size, material, finish) {
  const priceTable = {
    Poster: {
      "8x10": 25,
      "11x14": 40,
      "12x18": 55,
      "16x20": 75,
      "24x36": 120
    },
    Canvas: {
      "8x10": 80,
      "11x14": 110,
      "12x18": 145,
      "16x20": 190,
      "24x36": 320
    },
    Metal: {
      "8x10": 95,
      "11x14": 130,
      "12x18": 170,
      "16x20": 230,
      "24x36": 380
    },
    Wood: {
      "8x10": 85,
      "11x14": 120,
      "12x18": 160,
      "16x20": 210,
      "24x36": 340
    }
  };

  let basePrice = priceTable[material]?.[size] || 0;

  if (finish === "Glossy") {
    basePrice += 10;
  }

  return basePrice;
}

function formatCurrency(amount) {
  return `$${Number(amount || 0).toFixed(2)}`;
}

function renderCart() {
  const container = document.getElementById("cart-items");
  const totalEl = document.getElementById("cart-total");

  if (!container) return;

  const cart = getCart();
  container.innerHTML = "";

  let total = 0;

  if (!cart.length) {
    container.innerHTML = `<p class="muted">Your cart is empty.</p>`;
    if (totalEl) totalEl.textContent = "$0.00";
    return;
  }

  cart.forEach((item, index) => {
    const itemPrice = item.price ?? getPrice(item.size, item.material, item.finish);
    total += itemPrice;

    const div = document.createElement("div");
    div.className = "cart-item";
    div.innerHTML = `
      <img src="${item.image}" alt="Cart item" />
      <div class="cart-item-details">
        <strong>${item.size} - ${item.material} - ${item.finish}</strong>
        <div>${formatCurrency(itemPrice)}</div>
      </div>
      <div class="cart-item-actions">
        <button class="remove-btn" type="button" data-index="${index}">Remove</button>
      </div>
    `;

    container.appendChild(div);
  });

  container.querySelectorAll(".remove-btn").forEach((button) => {
    button.addEventListener("click", () => {
      const index = Number(button.dataset.index);
      const cart = getCart();
      cart.splice(index, 1);
      saveCart(cart);
      renderCart();
    });
  });

  if (totalEl) {
    totalEl.textContent = formatCurrency(total);
  }
}

/* =============================
   SIMPLE FORMAT MODAL
============================= */

let pendingImage = null;
let pendingTitle = null;

function ensureFormatModal() {
  let modal = document.getElementById("format-modal");
  if (modal) return modal;

  modal = document.createElement("div");
  modal.id = "format-modal";

  modal.style.position = "fixed";
  modal.style.inset = "0";
  modal.style.zIndex = "99999";
  modal.style.display = "none";
  modal.style.alignItems = "center";
  modal.style.justifyContent = "center";
  modal.style.padding = "24px";
  modal.style.background = "rgba(0,0,0,0.7)";
  modal.style.backdropFilter = "blur(6px)";

  modal.innerHTML = `
    <div id="format-modal-panel">
      <button id="format-modal-close" type="button" aria-label="Close">×</button>
      <h2 id="format-modal-title">Choose Your Selections</h2>

      <div id="format-preview-wrap">
        <img id="modal-preview" alt="Selected photo preview" />
      </div>

      <div class="format-field">
        <label for="modal-size">Size</label>
        <select id="modal-size">
          <option value="">Select size</option>
          <option>8x10</option>
          <option>11x14</option>
          <option>12x18</option>
          <option>16x20</option>
          <option>24x36</option>
        </select>
      </div>

      <div class="format-field">
        <label for="modal-material">Material</label>
        <select id="modal-material">
          <option value="">Select material</option>
          <option>Poster</option>
          <option>Canvas</option>
          <option>Metal</option>
          <option>Wood</option>
        </select>
      </div>

      <div class="format-field">
        <label for="modal-finish">Finish</label>
        <select id="modal-finish">
          <option value="">Select finish</option>
          <option>Matte</option>
          <option>Glossy</option>
        </select>
      </div>

      <div id="format-price"></div>

      <div id="format-actions">
        <button id="modal-back" type="button">Back to Gallery</button>
        <button id="modal-checkout" type="button" disabled>Checkout</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const panel = document.getElementById("format-modal-panel");
  const closeBtn = document.getElementById("format-modal-close");
  const preview = document.getElementById("modal-preview");
  const size = document.getElementById("modal-size");
  const material = document.getElementById("modal-material");
  const finish = document.getElementById("modal-finish");
  const backBtn = document.getElementById("modal-back");
  const checkoutBtn = document.getElementById("modal-checkout");
  const priceEl = document.getElementById("format-price");

  panel.style.width = "min(620px, 100%)";
  panel.style.maxHeight = "90vh";
  panel.style.overflowY = "auto";
  panel.style.background = "#111";
  panel.style.border = "1px solid rgba(255,255,255,0.12)";
  panel.style.borderRadius = "24px";
  panel.style.padding = "28px";
  panel.style.boxShadow = "0 24px 80px rgba(0,0,0,0.45)";
  panel.style.position = "relative";
  panel.style.color = "#fff";

  closeBtn.style.position = "absolute";
  closeBtn.style.top = "10px";
  closeBtn.style.right = "12px";
  closeBtn.style.border = "none";
  closeBtn.style.background = "transparent";
  closeBtn.style.color = "#fff";
  closeBtn.style.fontSize = "28px";
  closeBtn.style.cursor = "pointer";

  document.getElementById("format-modal-title").style.margin = "0 0 18px";
  document.getElementById("format-modal-title").style.fontSize = "1.5rem";

  preview.style.display = "block";
  preview.style.width = "100%";
  preview.style.maxHeight = "260px";
  preview.style.objectFit = "cover";
  preview.style.borderRadius = "16px";
  preview.style.marginBottom = "18px";

  modal.querySelectorAll(".format-field").forEach((field) => {
    field.style.marginBottom = "16px";
  });

  modal.querySelectorAll("label").forEach((label) => {
    label.style.display = "block";
    label.style.marginBottom = "8px";
    label.style.fontWeight = "600";
  });

[size, material, finish].forEach((select) => {
  select.style.width = "100%";
  select.style.padding = "14px 16px";
  select.style.borderRadius = "12px";
  select.style.border = "1px solid rgba(255,255,255,0.18)";
  select.style.background = "#ffffff";
  select.style.color = "#111111";
  select.style.fontSize = "1rem";
  select.style.boxSizing = "border-box";
  select.style.appearance = "auto";
  select.style.webkitAppearance = "menulist";
  select.style.mozAppearance = "menulist";
  select.style.outline = "none";
  select.style.boxShadow = "none";
});

[size, material, finish].forEach((select) => {
  Array.from(select.options).forEach((option) => {
    option.style.backgroundColor = "#ffffff";
    option.style.color = "#111111";
  });
});

  priceEl.style.margin = "8px 0 18px";
  priceEl.style.fontSize = "1rem";
  priceEl.style.fontWeight = "600";
  priceEl.style.color = "#e6d6ae";
  priceEl.textContent = "";

  const styleButton = (btn, primary = false) => {
    btn.style.padding = "12px 18px";
    btn.style.borderRadius = "12px";
    btn.style.cursor = "pointer";
    btn.style.fontSize = "0.95rem";
    btn.style.fontWeight = "600";
    if (primary) {
      btn.style.border = "none";
      btn.style.background = "linear-gradient(180deg, #f4dfac, #d6b36a)";
      btn.style.color = "#171717";
    } else {
      btn.style.border = "1px solid rgba(255,255,255,0.14)";
      btn.style.background = "rgba(255,255,255,0.06)";
      btn.style.color = "#fff";
    }
  };

  document.getElementById("format-actions").style.display = "flex";
  document.getElementById("format-actions").style.flexWrap = "wrap";
  document.getElementById("format-actions").style.gap = "12px";
  document.getElementById("format-actions").style.marginTop = "10px";

  styleButton(backBtn, false);
  styleButton(checkoutBtn, true);
  checkoutBtn.disabled = true;
  checkoutBtn.style.opacity = "0.55";

  function updateCheckoutState() {
    const ready = size.value && material.value && finish.value;

    checkoutBtn.disabled = !ready;
    checkoutBtn.style.opacity = ready ? "1" : "0.55";

    if (ready) {
      const price = getPrice(size.value, material.value, finish.value);
      priceEl.textContent = `Price: ${formatCurrency(price)}`;
    } else {
      priceEl.textContent = "";
    }
  }

  [size, material, finish].forEach((select) => {
    select.addEventListener("change", updateCheckoutState);
  });

  function closeFormatModal() {
    modal.style.display = "none";
    pendingImage = null;
    pendingTitle = null;
  }

  closeBtn.onclick = closeFormatModal;
  backBtn.onclick = closeFormatModal;

  checkoutBtn.onclick = () => {
    const cart = getCart();

    console.log("pendingTitle before cart push =", pendingTitle);

    cart.push({
  title: pendingTitle || "",
  image: pendingImage,
  size: size.value,
  material: material.value,
  finish: finish.value,
  price: getPrice(size.value, material.value, finish.value)
});

    saveCart(cart);
    renderCart();
    closeFormatModal();
    showPage("order");
  };

  modal.addEventListener("click", (e) => {
    if (e.target === modal) {
      closeFormatModal();
    }
  });

  return modal;
}

function openFormatModal(image, title = "") {
  const modal = ensureFormatModal();

  pendingImage = image;
  pendingTitle = title;

  const preview = document.getElementById("modal-preview");
  const size = document.getElementById("modal-size");
  const material = document.getElementById("modal-material");
  const finish = document.getElementById("modal-finish");
  const checkoutBtn = document.getElementById("modal-checkout");
  const priceEl = document.getElementById("format-price");

  preview.src = image;
  size.value = "";
  material.value = "";
  finish.value = "";
  checkoutBtn.disabled = true;
  checkoutBtn.style.opacity = "0.55";
  priceEl.textContent = "";

  modal.style.display = "flex";
}

/* =============================
   LIGHTBOX
============================= */

let galleryImages = [];
let currentIndex = 0;

function closeLightbox() {
  const lightbox = document.getElementById("lightbox");
  if (lightbox) {
    lightbox.classList.remove("active");
  }
}

function ensureLightbox() {
  let lightbox = document.getElementById("lightbox");

  if (!lightbox) {
    lightbox = document.createElement("div");
    lightbox.id = "lightbox";
    document.body.appendChild(lightbox);
  }

 lightbox.innerHTML = `
  <div id="lightbox-content" style="position:relative; display:inline-block; max-width:92vw; max-height:92vh;">
    <button
      id="lightbox-close"
      type="button"
      aria-label="Close image"
      style="
        position:absolute;
        top:10px;
        right:10px;
        z-index:100001;
        width:42px;
        height:42px;
        border:none;
        border-radius:999px;
        background:rgba(0,0,0,0.65);
        color:#fff;
        font-size:28px;
        line-height:1;
        cursor:pointer;
      "
    >&times;</button>

    <button
      id="lightbox-prev"
      class="lightbox-nav"
      type="button"
      aria-label="Previous image"
      style="
        position:absolute;
        left:-64px;
        top:50%;
        transform:translateY(-50%);
      "
    >&#10094;</button>

    <img
      id="lightbox-img"
      alt="Expanded gallery image"
      style="
        display:block;
        max-width:92vw;
        max-height:92vh;
        width:auto;
        height:auto;
        border-radius:18px;
      "
    />

    <button
      id="lightbox-next"
      class="lightbox-nav"
      type="button"
      aria-label="Next image"
      style="
        position:absolute;
        right:-64px;
        top:50%;
        transform:translateY(-50%);
      "
    >&#10095;</button>

    <div
      id="lightbox-caption"
      style="
        margin-top:12px;
        text-align:center;
      "
    ></div>
  </div>
`;

  const closeBtn = document.getElementById("lightbox-close");
  const prevBtn = document.getElementById("lightbox-prev");
  const nextBtn = document.getElementById("lightbox-next");
  const img = document.getElementById("lightbox-img");

  const content = document.getElementById("lightbox-content");

if (window.innerWidth <= 768) {
  prevBtn.style.left = "8px";
  nextBtn.style.right = "8px";
}

  closeBtn.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    closeLightbox();
  };

  prevBtn.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    showLightbox(currentIndex - 1);
  };

  nextBtn.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    showLightbox(currentIndex + 1);
  };

  img.onclick = (e) => {
    e.stopPropagation();
  };

  lightbox.onclick = (e) => {
    if (e.target === lightbox) {
      closeLightbox();
    }
  };
}

function showLightbox(index) {
  if (!galleryImages.length) return;

  ensureLightbox();

  currentIndex = (index + galleryImages.length) % galleryImages.length;

  const img = galleryImages[currentIndex];
  const lightboxImg = document.getElementById("lightbox-img");
  const caption = document.getElementById("lightbox-caption");
  const lightbox = document.getElementById("lightbox");

  lightboxImg.src = img.src;
  caption.textContent = img.dataset.caption || "";
  lightbox.classList.add("active");
}

/* =============================
   GALLERY CONNECTION
============================= */

window.App = {
  registerGallery(images) {
    galleryImages = images;
    ensureLightbox();
  },

  openLightboxByIndex(index) {
    showLightbox(index);
  },

  buyNowFromGallery(photo) {
    if (!photo || !photo.src) {
      console.error("Invalid photo passed to buyNowFromGallery:", photo);
      return;
    }

    console.log("buyNowFromGallery photo =", photo);

openFormatModal(photo.src, photo.title || "");  }
};

window.addPhotoToCartByIndex = function (index) {
  const photos = window.galleryPhotos || [];
  const photo = photos[index];

  console.log("window.addPhotoToCartByIndex called:", { index, photo });

  if (!photo) {
    console.error("No photo found for index:", index);
    return;
  }

  if (window.App && typeof window.App.buyNowFromGallery === "function") {
    window.App.buyNowFromGallery(photo);
  } else {
    console.error("buyNowFromGallery is not available");
  }
};

/* =============================
   SQUARE PAYMENT
============================= */

let squarePayments = null;
let squareCard = null;
let squareInitPromise = null;

async function initSquare() {
  const cardContainer = document.getElementById("card-container");
  if (!cardContainer) {
    console.error("Square error: #card-container not found");
    return;
  }

  if (squareCard) return;
  if (squareInitPromise) return squareInitPromise;

  squareInitPromise = (async () => {
    try {
      if (!window.Square) {
        throw new Error("Square SDK not loaded");
      }

      const res = await fetch("/api/config/square");
      const config = await res.json();

      console.log("Square config:", config);

      if (!res.ok || !config.appId || !config.locationId) {
        throw new Error("Missing Square configuration");
      }

      squarePayments = window.Square.payments(config.appId, config.locationId);
      squareCard = await squarePayments.card();
      await squareCard.attach("#card-container");

      console.log("Square initialized successfully");
    } catch (err) {
      console.error("Square init error:", err);
      squareCard = null;
      throw err;
    } finally {
      squareInitPromise = null;
    }
  })();

  return squareInitPromise;
}

async function handleSquarePayment() {
  try {
    const payBtn = document.getElementById("square-pay-btn");

    if (!squareCard) {
      alert("Payment form is not ready yet.");
      return;
    }

    const cart = getCart();
    if (!cart.length) {
      alert("Your cart is empty.");
      return;
    }

    if (payBtn) {
      payBtn.disabled = true;
      payBtn.textContent = "Processing Payment...";
    }

    const total = cart.reduce((sum, item) => {
      return sum + (item.price ?? getPrice(item.size, item.material, item.finish));
    }, 0);

    const result = await squareCard.tokenize();

    if (result.status !== "OK") {
      throw new Error("Card tokenization failed");
    }

    const customer = {
  name: document.getElementById("cust-name")?.value?.trim() || "",
  email: document.getElementById("cust-email")?.value?.trim() || "",
  phone: document.getElementById("cust-phone")?.value?.trim() || "",
  address: document.getElementById("cust-address")?.value?.trim() || "",
  city: document.getElementById("cust-city")?.value?.trim() || "",
  state: document.getElementById("cust-state")?.value?.trim() || "",
  zip: document.getElementById("cust-zip")?.value?.trim() || ""
};

console.log("cart being sent to server =", cart);
const paymentRes = await fetch("/api/payments/square", {
  method: "POST",
  headers: {
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    sourceId: result.token,
    amount: Math.round(total * 100),
    orderDetails: {
      customer, // 👈 THIS WAS MISSING
      items: cart,
      total: total
    }
  })
});

    console.log("Raw payment response:", paymentRes);

if (!paymentRes.ok) {
  const errorText = await paymentRes.text();
  console.error("Payment failed response:", errorText);
  throw new Error("Payment request failed");
}

const paymentData = await paymentRes.json();
console.log("Parsed payment data:", paymentData);

    localStorage.setItem("lastOrder", JSON.stringify({
      paymentId: paymentData.paymentId,
      total: `$${total.toFixed(2)}`,
      items: cart
    }));

    localStorage.removeItem("cart");
    renderCart();

    window.location.href = "/success.html";
  } catch (err) {
    console.error("Square payment error:", err);
    alert("Payment failed. Please try again.");
  } finally {
    const payBtn = document.getElementById("square-pay-btn");
    if (payBtn) {
      payBtn.disabled = false;
      payBtn.textContent = "Pay with Card";
    }
  }
}

/* =============================
   INIT
============================= */

document.addEventListener("DOMContentLoaded", () => {
  bindPageNavigation();
  const params = new URLSearchParams(window.location.search);
const page = params.get("page") || "home";
showPage(page);
  renderCart();

  const squarePayBtn = document.getElementById("square-pay-btn");
  if (squarePayBtn) {
    squarePayBtn.addEventListener("click", handleSquarePayment);
  }

  const clearCartBtn = document.getElementById("clear-cart-btn");
  if (clearCartBtn) {
    clearCartBtn.addEventListener("click", () => {
      localStorage.removeItem("cart");
      renderCart();
    });
  }

  const copyrightYear = document.getElementById("copyright-year");
  if (copyrightYear) {
    copyrightYear.textContent = new Date().getFullYear();
  }
});