console.log("MAIN JS LOADED - TEST 12345");

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

let pricingData = [];
let pricingLoaded = false;

async function loadPricing() {
  try {
    const res = await fetch("/api/pricing");

    if (!res.ok) {
      throw new Error(`Failed to load pricing: ${res.status}`);
    }

    const rows = await res.json();

    pricingData = Array.isArray(rows) ? rows : [];
    pricingLoaded = true;

    console.log("Pricing loaded from DB:", pricingData);
  } catch (err) {
    console.error("Error loading pricing from DB:", err);
    pricingData = [];
    pricingLoaded = false;
  }
}

function getBasePriceFromDb(size, material, finish = "") {
  const normalizedMaterial = String(material || "")
    .trim()
    .toLowerCase();
  const normalizedSize = String(size || "")
    .trim()
    .toLowerCase();
  const normalizedFinish = String(finish || "")
    .trim()
    .toLowerCase();

  const exactMatch = pricingData.find((item) => {
    return (
      String(item.material || "")
        .trim()
        .toLowerCase() === normalizedMaterial &&
      String(item.size || "")
        .trim()
        .toLowerCase() === normalizedSize &&
      String(item.finish || "")
        .trim()
        .toLowerCase() === normalizedFinish
    );
  });

  if (exactMatch) return Number(exactMatch.price || 0);

  const blankFinishMatch = pricingData.find((item) => {
    return (
      String(item.material || "")
        .trim()
        .toLowerCase() === normalizedMaterial &&
      String(item.size || "")
        .trim()
        .toLowerCase() === normalizedSize &&
      String(item.finish || "").trim() === ""
    );
  });

  if (blankFinishMatch) return Number(blankFinishMatch.price || 0);

  return 0;
}

const PRICING = {
  Poster: {
    "11x14": 20.79,
    "12x18": 23.99,
    "16x20": 31.99,
    "20x30": 41.59,
    "24x36": 51.19,
  },
  Canvas: {
    "8x10": 63.99,
    "11x14": 79.99,
    "12x12": 79.99,
    "16x20": 143.99,
    "20x24": 239.99,
    "20x30": 271.99,
  },
  Metal: {
    "5x7": 47.99,
    "8x10": 59.19,
    "11x14": 95.99,
    "12x12": 95.99,
    "16x20": 111.99,
    "20x24": 159.99,
    "20x30": 207.99,
  },
  Wood: {
    "5x7": 39.99,
    "8x10": 63.99,
    "11x14": 95.99,
    "12x12": 95.99,
    "16x20": 111.99,
    "20x30": 159.99,
  },
};

const UPSELL_CONFIG = {
  Poster: {
    label: "Alternate finish",
    items: [
      {
        material: "Metal",
        title: "Try Metal",
        description:
          "Adds bold color, crisp detail, and a sleek modern presentation.",
      },
    ],
  },
  Metal: {
    label: "Alternate finish",
    items: [
      {
        material: "Wood",
        title: "Prefer a natural display?",
        description:
          "Wood offers a warmer, handcrafted presentation with rustic character.",
      },
    ],
  },
  Wood: {
    label: "Popular alternative",
    items: [
      {
        material: "Metal",
        title: "Try Metal",
        description:
          "Metal gives wildlife and landscapes extra vibrancy, contrast, and detail.",
      },
    ],
  },
};

function getPricingMaterials() {
  const allowedMaterials = Object.keys(STOREFRONT_ALLOWED);

  if (pricingLoaded && Array.isArray(pricingData) && pricingData.length) {
    return [
      ...new Set(pricingData.map((row) => String(row.material || "").trim())),
    ]
      .filter((material) => allowedMaterials.includes(material))
      .filter(Boolean);
  }

  return allowedMaterials;
}

function getSizesForMaterial(material) {
  if (pricingLoaded && Array.isArray(pricingData) && pricingData.length) {
    const normalizedMaterial = String(material || "")
      .trim()
      .toLowerCase();

    return [
      ...new Set(
        pricingData
          .filter(
            (row) =>
              String(row.material || "")
                .trim()
                .toLowerCase() === normalizedMaterial,
          )
          .map((row) => String(row.size || "").trim())
          .filter(Boolean),
      ),
    ];
  }

  return Object.keys(PRICING[material] || {});
}

function getDisplayBasePrice(material, size, finish = "") {
  if (pricingLoaded && Array.isArray(pricingData) && pricingData.length) {
    return getBasePriceFromDb(size, material, finish);
  }

  return Number(PRICING[material]?.[size] || 0);
}

function getStartingPrice(material) {
  const sizes = getSizesForMaterial(material);
  const prices = sizes
    .map((size) => getDisplayBasePrice(material, size))
    .filter((price) => Number(price) > 0);

  if (!prices.length) return 0;
  return Math.min(...prices);
}

function getValidPricingRowsForMaterial(material) {
  if (!pricingLoaded || !Array.isArray(pricingData) || !pricingData.length) {
    return [];
  }

  const normalizedMaterial = String(material || "")
    .trim()
    .toLowerCase();
  const allowedSizes = STOREFRONT_ALLOWED[material] || [];

  return pricingData.filter((row) => {
    const rowMaterial = String(row.material || "")
      .trim()
      .toLowerCase();
    const rowSize = String(row.size || "").trim();
    const rowPrice = Number(row.price || 0);

    return (
      rowMaterial === normalizedMaterial &&
      allowedSizes.includes(rowSize) &&
      rowPrice > 0
    );
  });
}

function getGroupedSizesForPricingCard(material) {
  const rows = getValidPricingRowsForMaterial(material);

  if (!rows.length) {
    return getAvailableSizes(material).map((size) => ({
      size,
      basePrice: Number(PRICING[material]?.[size] || 0),
      finishes: [],
    }));
  }

  const grouped = {};

  rows.forEach((row) => {
    const size = String(row.size || "").trim();
    const finish = String(row.finish || "").trim();
    const price = Number(row.price || 0);

    if (!size || price <= 0) return;

    if (!grouped[size]) {
      grouped[size] = {
        size,
        basePrice: price,
        finishes: [],
      };
    }

    if (price < grouped[size].basePrice) {
      grouped[size].basePrice = price;
    }

    grouped[size].finishes.push({
      finish,
      price,
    });
  });

  return sortSizesCustom(Object.keys(grouped).map((size) => [size, null])).map(
    ([size]) => grouped[size],
  );
}

function getStartingPriceForMaterial(material) {
  const groupedSizes = getGroupedSizesForPricingCard(material);
  const prices = groupedSizes
    .map((item) => Number(item.basePrice || 0))
    .filter((price) => price > 0);

  if (!prices.length) return 0;
  return Math.min(...prices);
}

function getRecommendedFinishMessage(material, sizeGroup) {
  if (
    !sizeGroup ||
    !Array.isArray(sizeGroup.finishes) ||
    !sizeGroup.finishes.length
  ) {
    if (material === "Metal") {
      return "Vivid color, sharp detail, and a sleek modern finish.";
    }

    if (material === "Wood") {
      return "Warm, natural presentation with a rustic feel.";
    }

    if (material === "Poster") {
      return "Clean, classic print presentation for everyday display.";
    }

    return "Premium presentation options available.";
  }

  const finishes = sizeGroup.finishes
    .map((item) =>
      String(item.finish || "")
        .trim()
        .toLowerCase(),
    )
    .filter(Boolean);

  if (finishes.includes("glossy")) {
    return "Glossy adds extra vibrancy and punch.";
  }

  if (finishes.includes("lustre")) {
    return "Lustre keeps rich color with less glare.";
  }

  if (finishes.includes("semi-gloss")) {
    return "Semi-gloss balances pop with a softer reflection.";
  }

  if (finishes.includes("matte")) {
    return "Matte gives a softer, refined fine-art look.";
  }

  return "Premium presentation options available.";
}

function getUpsellsForMaterial(material) {
  return UPSELL_CONFIG[material]?.items || [];
}

function getAvailableSizes(material) {
  const allowedSizes = STOREFRONT_ALLOWED[material] || [];
  let sizes = [];

  if (pricingLoaded && pricingData.length) {
    sizes = pricingData
      .filter((item) => String(item.material) === String(material))
      .map((item) => item.size);
  } else {
    sizes = Object.keys(PRICING[material] || {});
  }

  sizes = sizes.filter((size) => allowedSizes.includes(String(size)));

  return sortSizesCustom(sizes.map((size) => [size, null])).map(
    ([size]) => size,
  );
}

function getPrice(size, material, finish = "") {
  let basePrice = 0;

  if (pricingLoaded && pricingData.length) {
    basePrice = getBasePriceFromDb(size, material, finish);
  } else {
    basePrice = Number(PRICING[material]?.[size] || 0);
  }

  return Number(basePrice || 0);
}

function formatCurrency(amount) {
  return `$${Number(amount || 0).toFixed(2)}`;
}

function showPaymentLoading(message = "Processing payment...") {
  console.log("🚀 showPaymentLoading called");

  showPaymentStatus(
    `<span class="payment-spinner"></span><span>${message}</span>`,
    false,
  );
}

function showPaymentStatus(message, isError = false) {
  const statusEl = document.getElementById("payment-status");
  if (!statusEl) return;

  if (!message || !message.trim()) {
    statusEl.innerHTML = "";
    statusEl.className = "payment-status";
    statusEl.style.display = "none";
    return;
  }

  statusEl.innerHTML = message.replace(/\n/g, "<br>");
  statusEl.className = `payment-status show ${isError ? "error" : "success"}`;
  statusEl.style.display = "block";
}

function setPayButtonState(isDisabled, label = "Pay with Card") {
  const payBtn = document.getElementById("square-pay-btn");
  if (!payBtn) return;

  payBtn.disabled = isDisabled;
  payBtn.textContent = label;
  payBtn.classList.toggle(
    "is-loading",
    isDisabled && label.includes("Processing"),
  );
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
    const itemPrice =
      item.price ?? getPrice(item.size, item.material, item.finish);
    const displayMaterial = getDisplayMaterialName(item.material);
    total += itemPrice;

    const div = document.createElement("div");
    div.className = "cart-item";
    div.innerHTML = `
    ${
      item.image
        ? `<img src="${item.image}" alt="Cart item" />`
        : `<div class="cart-item-image-placeholder">No preview</div>`
    }
        <div class="cart-item-details">
        <strong>${item.size} - ${displayMaterial}${item.finish ? ` - ${item.finish}` : ""}</strong>
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
  updatePayButtonAvailability();
}

function getUserFriendlyError(error) {
  const msg = (error || "").toLowerCase();

  if (msg.includes("pan_failure")) {
    return "Your card was declined. Please check your details or try another card.";
  }

  if (msg.includes("cvv")) {
    return "The security code (CVV) is incorrect. Please check and try again.";
  }

  if (msg.includes("expired")) {
    return "Your card has expired. Please use a different card.";
  }

  if (msg.includes("insufficient")) {
    return "There are insufficient funds on this card.";
  }

  if (msg.includes("network")) {
    return "Network issue detected. Please check your connection and try again.";
  }

  return "We couldn't process your payment. Please try again or use a different card.";
}

/* =============================
   SIMPLE FORMAT MODAL
============================= */

let pendingImage = null;
let pendingTitle = null;

let FORMAT_OPTIONS = {
  Poster: [],
  Canvas: [],
  Metal: [],
  Wood: [],
};

const FINISH_OPTIONS = {
  poster: [
    { value: "matte", label: "Matte" },
    { value: "lustre", label: "Lustre" },
  ],
  metal: [
    { value: "matte", label: "Matte" },
    { value: "glossy", label: "Glossy" },
    { value: "semi-gloss", label: "Semi-Gloss" },
  ],
  wood: [],
  canvas: [],
};

const STOREFRONT_ALLOWED = {
  Poster: ["12x18", "16x20", "20x30", "24x36"],
  Metal: ["5x7", "8x10", "11x14", "12x12", "16x20", "20x24"],
  Wood: ["5x7", "8x10", "11x14", "12x12", "16x20", "20x30"],
};

const MATERIAL_DISPLAY_NAMES = {
  Poster: "Photo Print",
  Metal: "Metal",
  Wood: "Wood",
};

function getDisplayMaterialName(material) {
  return MATERIAL_DISPLAY_NAMES[material] || material || "";
}

const MOST_POPULAR_MATERIAL = "Metal";
const MOST_POPULAR_SIZE_BY_MATERIAL = {
  Poster: "16x20",
  Metal: "8x10",
  Wood: "11x14",
};

function getAvailableMaterials() {
  const allowedMaterials = Object.keys(STOREFRONT_ALLOWED);

  if (pricingLoaded && pricingData.length) {
    return [
      ...new Set(pricingData.map((item) => item.material).filter(Boolean)),
    ]
      .filter((material) => allowedMaterials.includes(String(material)))
      .sort((a, b) => String(a).localeCompare(String(b)));
  }

  return allowedMaterials;
}

function refreshFormatOptions() {
  const materials = getAvailableMaterials();

  FORMAT_OPTIONS = {};

  materials.forEach((material) => {
    FORMAT_OPTIONS[material] = getAvailableSizes(material);
  });
}

function populateMaterials(selectEl) {
  if (!selectEl) return;

  selectEl.innerHTML = `<option value="">Select format</option>`;

  const materials = getAvailableMaterials();

  materials.forEach((material) => {
    const option = document.createElement("option");
    option.value = material;
    option.textContent = MATERIAL_DISPLAY_NAMES[material] || material;
    selectEl.appendChild(option);
  });
}

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
      <h2 id="format-modal-title">Choose Your Print Options</h2>

      <div id="format-preview-wrap">
        <img id="modal-preview" alt="Selected photo preview" />
      </div>

      <div class="format-field">
  <label for="modal-material">Format</label>
  <select id="modal-material">
    <option value="">Select format</option>
  </select>
</div>

      <div class="format-field">
        <label for="modal-size">Size</label>
        <select id="modal-size" disabled>
          <option value="">Select size</option>
        </select>
      </div>

            <div class="format-field" id="modal-finish-field">
        <label for="modal-finish">Finish</label>
        <select id="modal-finish" disabled>
          <option value="">Select finish</option>
        </select>
      </div>

      <div id="format-price"></div>
      <div id="format-upsell"></div>
      <div id="format-error" style="
  color:#ff6b6b;
  font-size:0.9rem;
  margin-bottom:12px;
  display:none;
"></div>

      <div id="format-actions">
        <button id="modal-back" type="button">Cancel</button>
        <button id="modal-checkout" type="button" disabled>Add To Cart</button>
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
  const errorEl = document.getElementById("format-error");
  closeBtn.onclick = closeFormatModal;
  backBtn.onclick = closeFormatModal;

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

  [material, size, finish].forEach((select) => {
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

  priceEl.style.margin = "8px 0 18px";
  priceEl.style.fontSize = "1rem";
  priceEl.style.fontWeight = "600";
  priceEl.style.color = "#e6d6ae";
  priceEl.textContent = "";

  const upsellEl = document.getElementById("format-upsell");
  upsellEl.style.display = "none";
  upsellEl.style.margin = "0 0 18px";
  upsellEl.style.padding = "14px";
  upsellEl.style.borderRadius = "16px";
  upsellEl.style.background = "rgba(255,255,255,0.05)";
  upsellEl.style.border = "1px solid rgba(255,255,255,0.10)";
  upsellEl.style.color = "#f3f3f3";

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

  checkoutBtn.onclick = () => {
    const normalizedMaterial = String(material.value || "")
      .trim()
      .toLowerCase();
    const normalizedSize = String(size.value || "").trim();

    const matchingRows = pricingData.filter((row) => {
      const rowMaterial = String(row.material || "")
        .trim()
        .toLowerCase();
      const rowSize = String(row.size || "").trim();

      return rowMaterial === normalizedMaterial && rowSize === normalizedSize;
    });

    const finishRequired = matchingRows.some(
      (row) => String(row.finish || "").trim() !== "",
    );

    const selectedFinish = finishRequired
      ? String(finish.value || "")
          .trim()
          .toLowerCase()
      : "";

    if (!material.value || !size.value || (finishRequired && !finish.value)) {
      errorEl.style.display = "block";

      if (!material.value) {
        errorEl.textContent = "Please select a format.";
      } else if (!size.value) {
        errorEl.textContent = "Please select a size.";
      } else if (finishRequired && !finish.value) {
        errorEl.textContent = "Please select a finish.";
      }

      return;
    }

    const cart = getCart();

    const newItem = {
      title: pendingTitle || "",
      image: pendingImage,
      imageKey: pendingImage ? pendingImage.split("/").pop() : "",
      size: normalizedSize,
      material: material.value,
      finish: selectedFinish,
      price: getPrice(normalizedSize, material.value, selectedFinish),
    };

    console.log("🔥 New cart item:", newItem);

    cart.push(newItem);

    saveCart(cart);
    renderCart();
    closeFormatModal();
    showAddToCartSuccess(newItem);

    checkoutBtn.disabled = true;
    checkoutBtn.style.opacity = "0.55";
  };

  function populateSizes(selectedMaterial) {
    size.innerHTML = `<option value="">Select size</option>`;
    size.value = "";
    finish.innerHTML = `<option value="">Select finish</option>`;
    finish.value = "";
    finish.disabled = true;

    if (!selectedMaterial) {
      size.disabled = true;
      return;
    }

    const normalizedMaterial = String(selectedMaterial).trim().toLowerCase();

    const matchingRows = pricingData.filter(
      (row) =>
        String(row.material || "")
          .trim()
          .toLowerCase() === normalizedMaterial,
    );

    let uniqueSizes = [
      ...new Set(matchingRows.map((row) => String(row.size || "").trim())),
    ].filter(Boolean);

    // ✅ ADD THIS LINE
    uniqueSizes = sortSizesCustom(uniqueSizes.map((s) => [s, null])).map(
      ([s]) => s,
    );

    uniqueSizes.forEach((sizeValue) => {
      const option = document.createElement("option");
      option.value = sizeValue;
      option.textContent = sizeValue;
      size.appendChild(option);
    });

    size.disabled = uniqueSizes.length === 0;
  }

  function populateFinishes(selectedMaterial, selectedSize) {
    const finishField = document.getElementById("modal-finish-field");

    finish.innerHTML = `<option value="">Select finish</option>`;
    finish.value = "";

    if (!selectedMaterial || !selectedSize) {
      finish.disabled = true;
      if (finishField) finishField.style.display = "block";
      return;
    }

    const normalizedMaterial = String(selectedMaterial).trim().toLowerCase();
    const normalizedSize = String(selectedSize).trim();

    const matchingRows = pricingData.filter((row) => {
      const rowMaterial = String(row.material || "")
        .trim()
        .toLowerCase();
      const rowSize = String(row.size || "").trim();

      return rowMaterial === normalizedMaterial && rowSize === normalizedSize;
    });

    const uniqueFinishes = [
      ...new Set(
        matchingRows.map((row) =>
          String(row.finish || "")
            .trim()
            .toLowerCase(),
        ),
      ),
    ];

    const usableFinishes = uniqueFinishes.filter(Boolean);

    if (!usableFinishes.length) {
      finish.disabled = true;
      if (finishField) finishField.style.display = "none";
      return;
    }

    if (finishField) {
      finishField.style.display = "block";
    }

    usableFinishes.forEach((finishValue) => {
      const option = document.createElement("option");
      option.value = finishValue;
      option.textContent =
        finishValue === "semi-gloss"
          ? "Semi-Gloss"
          : finishValue.charAt(0).toUpperCase() + finishValue.slice(1);

      finish.appendChild(option);
    });

    finish.disabled = false;

    if (usableFinishes.length === 1) {
      finish.value = usableFinishes[0];
    }
  }

  function updateFormatUpsell() {
    const selectedMaterial = material.value;
    const upsells = getUpsellsForMaterial(selectedMaterial);

    if (!selectedMaterial || !upsells.length) {
      upsellEl.style.display = "none";
      upsellEl.innerHTML = "";
      return;
    }

    if (selectedMaterial === MOST_POPULAR_MATERIAL) {
      upsellEl.style.display = "block";
      upsellEl.innerHTML = `
    <div style="
      font-size:0.75rem;
      text-transform:uppercase;
      letter-spacing:0.08em;
      color:#d6b36a;
      margin-bottom:6px;
      font-weight:700;
    ">
      Most popular choice
    </div>
    <div style="
      font-size:0.96rem;
      line-height:1.45;
      color:#f3f3f3;
    ">
      Metal prints offer the most vibrant color and sharpest detail.
    </div>
  `;
      return;
    }

    const topUpsell = upsells[0];
    const topUpsellPrice = getStartingPriceForMaterial(topUpsell.material);

    upsellEl.style.display = "block";
    upsellEl.innerHTML = `
      <div style="
        font-size:0.75rem;
        text-transform:uppercase;
        letter-spacing:0.08em;
        color:#d6b36a;
        margin-bottom:6px;
        font-weight:700;
      ">
        Premium upgrade
      </div>
      <div style="
        font-size:0.98rem;
        font-weight:700;
        color:#fff;
        margin-bottom:4px;
      ">
        ${topUpsell.title}
      </div>
      <div style="
        font-size:0.9rem;
        line-height:1.45;
        color:#d8d8d8;
        margin-bottom:10px;
      ">
        ${topUpsell.description}
      </div>
      <div style="
        font-size:0.88rem;
        color:#f4dfac;
        font-weight:700;
        margin-bottom:12px;
      ">
        Starting at ${formatCurrency(topUpsellPrice)}
      </div>
      <button
        type="button"
        id="format-upsell-btn"
        style="
          padding:10px 14px;
          border:none;
          border-radius:12px;
          background:linear-gradient(180deg,#f4dfac,#d6b36a);
          color:#171717;
          font-weight:700;
          cursor:pointer;
          width:100%;
        "
      >
        ${topUpsell.title}
      </button>
    `;

    const upsellBtn = document.getElementById("format-upsell-btn");
    if (upsellBtn) {
      upsellBtn.onclick = () => {
        const previousSize = size.value;

        material.value = topUpsell.material;
        populateSizes(topUpsell.material);

        // Try to preserve size if it exists in new material
        const availableSizes = getAvailableSizes(topUpsell.material);

        if (availableSizes.includes(previousSize)) {
          size.value = previousSize;
          finish.disabled = false;
        } else {
          size.value = "";
          finish.value = "";
          finish.disabled = true;
        }

        updateCheckoutState();
      };
    }
  }

  function updateCheckoutState() {
    const selectedMaterial = String(material.value || "").trim();
    const selectedSize = String(size.value || "").trim();
    const selectedFinish = String(finish.value || "").trim();

    const normalizedMaterial = selectedMaterial.toLowerCase();

    const matchingRows = pricingData.filter((row) => {
      const rowMaterial = String(row.material || "")
        .trim()
        .toLowerCase();
      const rowSize = String(row.size || "").trim();

      return rowMaterial === normalizedMaterial && rowSize === selectedSize;
    });

    const finishRequired = matchingRows.some(
      (row) => String(row.finish || "").trim() !== "",
    );

    if (selectedMaterial) {
      size.disabled = false;
    } else {
      size.disabled = true;
      size.innerHTML = `<option value="">Select size</option>`;
      size.value = "";
      finish.disabled = true;
      finish.value = "";
    }

    if (selectedMaterial && selectedSize && finishRequired) {
      finish.disabled = false;
    } else if (!finishRequired) {
      finish.disabled = true;
      finish.value = "";
    } else {
      finish.disabled = true;
      finish.value = "";
    }

    const ready = finishRequired
      ? Boolean(selectedMaterial && selectedSize && selectedFinish)
      : Boolean(selectedMaterial && selectedSize);

    checkoutBtn.disabled = !ready;
    checkoutBtn.style.opacity = ready ? "1" : "0.55";

    updateFormatUpsell();

    if (ready) {
      const effectiveFinish = finishRequired ? selectedFinish : "";
      const price = getPrice(selectedSize, selectedMaterial, effectiveFinish);
      priceEl.textContent = `Price: ${formatCurrency(price)}`;
      errorEl.style.display = "none";
    } else {
      priceEl.textContent = "";
    }
  }

  function closeFormatModal() {
    modal.style.display = "none";
    pendingImage = null;
    pendingTitle = null;
  }

  material.addEventListener("change", () => {
    errorEl.style.display = "none";

    size.value = "";
    finish.value = "";

    populateSizes(material.value);
    populateFinishes(material.value, size.value);

    size.disabled = !material.value;

    updateCheckoutState();
  });

  size.addEventListener("change", () => {
    errorEl.style.display = "none";
    finish.value = "";

    populateFinishes(material.value, size.value);
    updateCheckoutState();
  });

  finish.addEventListener("change", () => {
    errorEl.style.display = "none";
    updateCheckoutState();
  });

  function showAddToCartSuccess(item) {
    let successModal = document.getElementById("cart-success-modal");

    const getSuccessPanelHtml = () => {
      const displayMaterial = getDisplayMaterialName(item?.material);

      return `
      <h3 style="margin-bottom:12px;">Added to Cart</h3>
      <p style="margin-bottom:18px; color:#ccc;">
        Your print has been added to your cart.
      </p>

      <div style="
        display:flex;
        gap:14px;
        align-items:center;
        text-align:left;
        background:rgba(255,255,255,0.04);
        border:1px solid rgba(255,255,255,0.08);
        border-radius:16px;
        padding:14px;
        margin-bottom:22px;
      ">
        <img
          src="${item?.image || ""}"
          alt="${item?.title || "Selected print"}"
          style="
            width:88px;
            height:88px;
            object-fit:cover;
            border-radius:12px;
            display:block;
            flex-shrink:0;
          "
        />

        <div style="min-width:0; flex:1;">
          <div style="
            font-size:1rem;
            font-weight:600;
            color:#fff;
            margin-bottom:8px;
          ">
            ${item?.title || "Photo Print"}
          </div>

          <div style="font-size:0.92rem; color:#d7d7d7; margin-bottom:4px;">
            <strong style="color:#fff;">Format:</strong> ${displayMaterial}
          </div>

          <div style="font-size:0.92rem; color:#d7d7d7; margin-bottom:4px;">
            <strong style="color:#fff;">Size:</strong> ${item?.size || ""}
          </div>

          <div style="font-size:0.92rem; color:#d7d7d7; margin-bottom:6px;">
            <strong style="color:#fff;">Finish:</strong> ${item?.finish || ""}
          </div>

          <div style="
            font-size:1rem;
            font-weight:700;
            color:#f4dfac;
          ">
            ${formatCurrency(item?.price || 0)}
          </div>
        </div>
      </div>

      <div style="display:flex; gap:12px; justify-content:center;">
        <button id="continue-shopping">Back to Gallery</button>
        <button id="go-to-cart">View Cart</button>
      </div>
    `;
    };

    const wireSuccessModal = () => {
      const successPanel = successModal.querySelector("#cart-success-panel");
      const continueBtn = successModal.querySelector("#continue-shopping");
      const cartBtn = successModal.querySelector("#go-to-cart");

      if (!successPanel || !continueBtn || !cartBtn) return;

      styleButton(continueBtn, false);
      styleButton(cartBtn, true);

      continueBtn.onclick = () => {
        successModal.style.opacity = "0";
        successPanel.style.opacity = "0";
        successPanel.style.transform = "translateY(10px) scale(0.98)";
        setTimeout(() => {
          successModal.style.display = "none";
        }, 200);
      };

      cartBtn.onclick = () => {
        successModal.style.display = "none";
        showPage("order");
      };

      requestAnimationFrame(() => {
        successModal.style.opacity = "1";
        successPanel.style.opacity = "1";
        successPanel.style.transform = "translateY(0) scale(1)";
      });
    };

    if (!successModal) {
      successModal = document.createElement("div");
      successModal.id = "cart-success-modal";

      successModal.style.position = "fixed";
      successModal.style.inset = "0";
      successModal.style.zIndex = "99999";
      successModal.style.display = "flex";
      successModal.style.alignItems = "center";
      successModal.style.justifyContent = "center";
      successModal.style.background = "rgba(0,0,0,0.6)";
      successModal.style.backdropFilter = "blur(8px)";
      successModal.style.opacity = "0";
      successModal.style.transition = "opacity 0.2s ease";

      successModal.innerHTML = `
      <div id="cart-success-panel" style="
        background:#111;
        border-radius:20px;
        padding:28px;
        width:min(460px, 92%);
        text-align:center;
        border:1px solid rgba(255,255,255,0.1);
        transform:translateY(10px) scale(0.98);
        opacity:0;
        transition:all 0.2s ease;
      ">
        ${getSuccessPanelHtml()}
      </div>
    `;

      document.body.appendChild(successModal);
      wireSuccessModal();
    } else {
      successModal.style.display = "flex";

      const successPanel = successModal.querySelector("#cart-success-panel");
      if (successPanel) {
        successPanel.innerHTML = getSuccessPanelHtml();
      }

      wireSuccessModal();
    }
  }

  return modal;
}

async function openFormatModal(image, title = "") {
  window.lastSelectedPhoto = {
    src: image,
    title: title,
  };
  const modal = ensureFormatModal();

  pendingImage = image;
  pendingTitle = title;

  await loadPricing();
  refreshFormatOptions();

  const preview = document.getElementById("modal-preview");
  const material = document.getElementById("modal-material");
  const size = document.getElementById("modal-size");
  const finish = document.getElementById("modal-finish");
  const checkoutBtn = document.getElementById("modal-checkout");
  const priceEl = document.getElementById("format-price");

  preview.src = image;
  populateMaterials(material);
  material.value = "";
  size.innerHTML = `<option value="">Select size</option>`;
  size.value = "";
  size.disabled = true;
  finish.innerHTML = `<option value="">Select finish</option>`;
  finish.value = "";
  finish.disabled = true;

  const finishField = document.getElementById("modal-finish-field");
  if (finishField) {
    finishField.style.display = "block";
  }
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

let lightboxZoom = 1;
let lightboxPanX = 0;
let lightboxPanY = 0;
let lightboxIsOpen = false;
let lightboxDraggingImage = false;

let pointerStartX = 0;
let pointerStartY = 0;
let pointerStartPanX = 0;
let pointerStartPanY = 0;

let pinchStartDistance = 0;
let pinchStartZoom = 1;
let swipeStartX = 0;
let swipeStartY = 0;

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function getLightbox() {
  return document.getElementById("lightbox");
}

function getLightboxContent() {
  return document.getElementById("lightbox-content");
}

function getLightboxImg() {
  return document.getElementById("lightbox-img");
}

function getLightboxCaption() {
  return document.getElementById("lightbox-caption");
}

function hideSiteChromeForLightbox() {
  document.body.classList.add("lightbox-open");
  document.body.style.overflow = "hidden";

  document
    .querySelectorAll("header, .site-header, .navbar, nav")
    .forEach((el) => {
      el.style.visibility = "hidden";
    });
}

function restoreSiteChromeFromLightbox() {
  document.body.classList.remove("lightbox-open");
  document.body.style.overflow = "";

  document
    .querySelectorAll("header, .site-header, .navbar, nav")
    .forEach((el) => {
      el.style.visibility = "";
    });
}

function applyLightboxTransform() {
  const img = getLightboxImg();
  if (!img) return;

  img.style.transform = `translate(${lightboxPanX}px, ${lightboxPanY}px) scale(${lightboxZoom})`;

  if (lightboxZoom > 1) {
    img.style.cursor = lightboxDraggingImage ? "grabbing" : "grab";
  } else {
    img.style.cursor = "zoom-in";
  }
}

function resetLightboxTransform() {
  lightboxZoom = 1;
  lightboxPanX = 0;
  lightboxPanY = 0;
  lightboxDraggingImage = false;
  applyLightboxTransform();
}

function zoomLightboxTo(nextZoom, clientX = null, clientY = null) {
  const img = getLightboxImg();
  if (!img) return;

  const oldZoom = lightboxZoom;
  const newZoom = clamp(nextZoom, 1, 4);

  if (newZoom === oldZoom) return;

  if (clientX !== null && clientY !== null && oldZoom > 0) {
    const rect = img.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const dx = clientX - centerX;
    const dy = clientY - centerY;

    lightboxPanX -= dx * ((newZoom - oldZoom) / oldZoom);
    lightboxPanY -= dy * ((newZoom - oldZoom) / oldZoom);
  }

  lightboxZoom = newZoom;

  if (lightboxZoom === 1) {
    lightboxPanX = 0;
    lightboxPanY = 0;
  }

  applyLightboxTransform();
}

function toggleLightboxZoom(clientX, clientY) {
  if (lightboxZoom > 1) {
    resetLightboxTransform();
  } else {
    zoomLightboxTo(2, clientX, clientY);
  }
}

function animateLightboxOpen() {
  const lightbox = getLightbox();
  const content = getLightboxContent();
  if (!lightbox || !content) return;

  lightbox.style.display = "flex";
  lightbox.style.opacity = "0";
  content.style.opacity = "0";
  content.style.transform = "scale(0.985)";

  requestAnimationFrame(() => {
    lightbox.style.opacity = "1";
    content.style.opacity = "1";
    content.style.transform = "scale(1)";
  });
}

function closeLightbox() {
  const lightbox = getLightbox();
  const content = getLightboxContent();

  lightboxIsOpen = false;
  resetLightboxTransform();

  if (lightbox && content) {
    lightbox.style.opacity = "0";
    content.style.opacity = "0";
    content.style.transform = "scale(0.985)";

    setTimeout(() => {
      if (!lightboxIsOpen && lightbox) {
        lightbox.style.display = "none";
      }
    }, 180);
  } else if (lightbox) {
    lightbox.style.display = "none";
  }

  restoreSiteChromeFromLightbox();
}

function showLightbox(index) {
  if (!galleryImages.length) return;

  ensureLightbox();

  currentIndex = (index + galleryImages.length) % galleryImages.length;

  const sourceImg = galleryImages[currentIndex];
  const lightboxImg = getLightboxImg();
  const caption = getLightboxCaption();
  const lightbox = getLightbox();

  if (!lightboxImg || !caption || !lightbox) return;

  lightboxImg.src = sourceImg.src;
  lightboxImg.alt = sourceImg.alt || "Expanded gallery image";
  const baseCaption = sourceImg.dataset.caption || "";

  caption.innerHTML = `
  ${baseCaption}
  <div style="font-size:0.8rem; color:#aaa; font-style:italic; margin-top:6px;">
    Preview optimized for web — prints use full-resolution originals
  </div>
`;
  resetLightboxTransform();
  lightboxIsOpen = true;

  hideSiteChromeForLightbox();
  animateLightboxOpen();

  lightbox.focus();
}

function handleLightboxKeydown(e) {
  if (!lightboxIsOpen) return;

  if (e.key === "Escape") {
    e.preventDefault();
    closeLightbox();
    return;
  }

  if (e.key === "ArrowLeft") {
    e.preventDefault();
    showLightbox(currentIndex - 1);
    return;
  }

  if (e.key === "ArrowRight") {
    e.preventDefault();
    showLightbox(currentIndex + 1);
  }
}

function ensureLightbox() {
  let lightbox = getLightbox();

  if (!lightbox) {
    lightbox = document.createElement("div");
    lightbox.id = "lightbox";
    document.body.appendChild(lightbox);
  }

  lightbox.tabIndex = -1;
  lightbox.style.position = "fixed";
  lightbox.style.inset = "0";
  lightbox.style.width = "100vw";
  lightbox.style.height = "100vh";
  lightbox.style.display = "none";
  lightbox.style.alignItems = "center";
  lightbox.style.justifyContent = "center";
  lightbox.style.background = "rgba(0,0,0,0.96)";
  lightbox.style.padding = "0";
  lightbox.style.zIndex = "100000";
  lightbox.style.boxSizing = "border-box";
  lightbox.style.opacity = "0";
  lightbox.style.transition = "opacity 0.18s ease";
  lightbox.style.outline = "none";

  lightbox.innerHTML = `
    <div
      id="lightbox-content"
      style="
        position: relative;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 100vw;
        height: 100vh;
        padding: 8px 8px 84px;
        box-sizing: border-box;
        opacity: 0;
        transform: scale(0.985);
        transition: opacity 0.18s ease, transform 0.18s ease;
        overflow: hidden;
        touch-action: none;
      "
    >
      <button
        id="lightbox-close"
        type="button"
        aria-label="Close image"
        style="
          position: absolute;
          top: 14px;
          right: 14px;
          z-index: 100001;
          width: 46px;
          height: 46px;
          border: none;
          border-radius: 999px;
          background: rgba(0,0,0,0.65);
          color: #fff;
          font-size: 30px;
          line-height: 1;
          cursor: pointer;
        "
      >&times;</button>

      <button
        id="lightbox-prev"
        type="button"
        aria-label="Previous image"
        style="
          position: absolute;
          left: 14px;
          top: 50%;
          transform: translateY(-50%);
          z-index: 100001;
          width: 48px;
          height: 48px;
          border: none;
          border-radius: 999px;
          background: rgba(0,0,0,0.55);
          color: #fff;
          font-size: 28px;
          cursor: pointer;
        "
      >&#10094;</button>

      <img
        id="lightbox-img"
        alt="Expanded gallery image"
        style="
          display: block;
          width: 100%;
          height: 100%;
          max-width: 100%;
          max-height: 100%;
          object-fit: contain;
          border-radius: 18px;
          cursor: zoom-in;
          transition: transform 0.2s ease;
          transform: translate(0px, 0px) scale(1);
          transform-origin: center center;
          user-select: none;
          -webkit-user-drag: none;
          will-change: transform;
        "
      />

      <button
        id="lightbox-next"
        type="button"
        aria-label="Next image"
        style="
          position: absolute;
          right: 14px;
          top: 50%;
          transform: translateY(-50%);
          z-index: 100001;
          width: 48px;
          height: 48px;
          border: none;
          border-radius: 999px;
          background: rgba(0,0,0,0.55);
          color: #fff;
          font-size: 28px;
          cursor: pointer;
        "
      >&#10095;</button>

<div
  id="lightbox-caption"
  style="
    position: absolute;
    left: 50%;
    bottom: max(18px, env(safe-area-inset-bottom));
    transform: translateX(-50%);
    width: min(92vw, 760px);
    text-align: center;
    color: #fff;
    background: rgba(0,0,0,0.58);
    padding: 10px 14px;
    border-radius: 12px;
    z-index: 100001;
    line-height: 1.5;
    font-size: 0.92rem;
    box-sizing: border-box;
  "
></div>
    </div>
  `;

  const content = getLightboxContent();
  const img = getLightboxImg();
  const closeBtn = lightbox.querySelector("#lightbox-close");
  const prevBtn = lightbox.querySelector("#lightbox-prev");
  const nextBtn = lightbox.querySelector("#lightbox-next");

  if (!content || !img || !closeBtn || !prevBtn || !nextBtn) {
    console.error("Lightbox elements not found");
    return;
  }

  if (window.innerWidth <= 768) {
    prevBtn.style.left = "8px";
    nextBtn.style.right = "8px";
    prevBtn.style.width = "42px";
    prevBtn.style.height = "42px";
    nextBtn.style.width = "42px";
    nextBtn.style.height = "42px";
  }

  closeBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    closeLightbox();
  });

  prevBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    showLightbox(currentIndex - 1);
  });

  nextBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    showLightbox(currentIndex + 1);
  });

  lightbox.addEventListener("click", (e) => {
    if (e.target === lightbox) {
      closeLightbox();
    }
  });

  img.addEventListener("click", (e) => {
    if (!lightboxIsOpen) return;
    if (lightboxDraggingImage) return;

    e.preventDefault();
    e.stopPropagation();

    toggleLightboxZoom(e.clientX, e.clientY);
  });

  img.addEventListener("pointerdown", (e) => {
    if (!lightboxIsOpen) return;

    pointerStartX = e.clientX;
    pointerStartY = e.clientY;
    pointerStartPanX = lightboxPanX;
    pointerStartPanY = lightboxPanY;
    lightboxDraggingImage = false;

    if (lightboxZoom > 1) {
      img.setPointerCapture?.(e.pointerId);
    }
  });

  img.addEventListener("pointermove", (e) => {
    if (!lightboxIsOpen || lightboxZoom <= 1) return;
    if ((e.buttons & 1) !== 1) return;

    const dx = e.clientX - pointerStartX;
    const dy = e.clientY - pointerStartY;

    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      lightboxDraggingImage = true;
    }

    lightboxPanX = pointerStartPanX + dx;
    lightboxPanY = pointerStartPanY + dy;
    applyLightboxTransform();
  });

  img.addEventListener("pointerup", () => {
    setTimeout(() => {
      lightboxDraggingImage = false;
      applyLightboxTransform();
    }, 0);
  });

  img.addEventListener("pointercancel", () => {
    lightboxDraggingImage = false;
    applyLightboxTransform();
  });

  content.addEventListener(
    "wheel",
    (e) => {
      if (!lightboxIsOpen) return;
      e.preventDefault();

      const delta = e.deltaY < 0 ? 0.25 : -0.25;
      zoomLightboxTo(lightboxZoom + delta, e.clientX, e.clientY);
    },
    { passive: false },
  );

  content.addEventListener(
    "touchstart",
    (e) => {
      if (!lightboxIsOpen) return;

      if (e.touches.length === 2) {
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        pinchStartDistance = Math.hypot(
          t1.clientX - t2.clientX,
          t1.clientY - t2.clientY,
        );
        pinchStartZoom = lightboxZoom;
        return;
      }

      if (e.touches.length === 1) {
        swipeStartX = e.touches[0].clientX;
        swipeStartY = e.touches[0].clientY;
        pointerStartX = e.touches[0].clientX;
        pointerStartY = e.touches[0].clientY;
        pointerStartPanX = lightboxPanX;
        pointerStartPanY = lightboxPanY;
        lightboxDraggingImage = false;
      }
    },
    { passive: true },
  );

  content.addEventListener(
    "touchmove",
    (e) => {
      if (!lightboxIsOpen) return;

      if (e.touches.length === 2) {
        e.preventDefault();

        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const distance = Math.hypot(
          t1.clientX - t2.clientX,
          t1.clientY - t2.clientY,
        );

        if (pinchStartDistance > 0) {
          const scaleFactor = distance / pinchStartDistance;
          zoomLightboxTo(pinchStartZoom * scaleFactor);
        }
        return;
      }

      if (e.touches.length === 1 && lightboxZoom > 1) {
        e.preventDefault();

        const dx = e.touches[0].clientX - pointerStartX;
        const dy = e.touches[0].clientY - pointerStartY;

        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
          lightboxDraggingImage = true;
        }

        lightboxPanX = pointerStartPanX + dx;
        lightboxPanY = pointerStartPanY + dy;
        applyLightboxTransform();
      }
    },
    { passive: false },
  );

  content.addEventListener("touchend", (e) => {
    if (!lightboxIsOpen) return;

    if (e.touches.length < 2) {
      pinchStartDistance = 0;
    }

    if (lightboxZoom === 1 && e.changedTouches.length === 1) {
      const touch = e.changedTouches[0];
      const dx = touch.clientX - swipeStartX;
      const dy = touch.clientY - swipeStartY;

      if (Math.abs(dx) > 50 && Math.abs(dy) < 60) {
        if (dx < 0) {
          showLightbox(currentIndex + 1);
        } else {
          showLightbox(currentIndex - 1);
        }
      }
    }

    setTimeout(() => {
      lightboxDraggingImage = false;
      applyLightboxTransform();
    }, 0);
  });

  if (!window._lightboxKeyHandlerAdded) {
    document.addEventListener("keydown", handleLightboxKeydown);
    window._lightboxKeyHandlerAdded = true;
  }
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

  async buyNowFromGallery(photo) {
    if (!photo || !photo.src) {
      console.error("Invalid photo passed to buyNowFromGallery:", photo);
      return;
    }

    console.log("buyNowFromGallery photo =", photo);

    try {
      await openFormatModal(photo.src, photo.title || "");
    } catch (err) {
      console.error("Failed to open format modal:", err);
      alert("Unable to load print options right now. Please try again.");
    }
  },
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

async function loadSquareSdk(scriptUrl) {
  if (window.Square) return;

  await new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-square-sdk="true"]');

    if (existing) {
      existing.addEventListener("load", resolve, { once: true });
      existing.addEventListener(
        "error",
        () => reject(new Error("Failed to load Square SDK")),
        { once: true },
      );
      return;
    }

    const script = document.createElement("script");
    script.src = scriptUrl;
    script.async = true;
    script.dataset.squareSdk = "true";
    script.onload = resolve;
    script.onerror = () =>
      reject(new Error(`Failed to load Square SDK from ${scriptUrl}`));
    document.head.appendChild(script);
  });
}

async function loadSquareSdk(scriptUrl) {
  if (window.Square) return;

  await new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-square-sdk="true"]');

    if (existing) {
      if (existing.dataset.loaded === "true") {
        resolve();
        return;
      }

      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener(
        "error",
        () => reject(new Error("Failed to load Square SDK")),
        { once: true },
      );
      return;
    }

    const script = document.createElement("script");
    script.src = scriptUrl;
    script.async = true;
    script.dataset.squareSdk = "true";

    script.onload = () => {
      script.dataset.loaded = "true";
      resolve();
    };

    script.onerror = () => {
      reject(new Error(`Failed to load Square SDK from ${scriptUrl}`));
    };

    document.head.appendChild(script);
  });
}

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
      const res = await fetch("/api/config/square");
      const config = await res.json();

      console.log("Square config:", config);

      if (!res.ok || !config.appId || !config.locationId || !config.scriptUrl) {
        throw new Error("Missing Square configuration");
      }

      await loadSquareSdk(config.scriptUrl);

      if (!window.Square) {
        throw new Error("Square SDK not loaded");
      }

      squarePayments = window.Square.payments(config.appId, config.locationId);
      squareCard = await squarePayments.card();
      await squareCard.attach("#card-container");

      console.log("Square initialized successfully");
      updatePayButtonAvailability();
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

function clearCheckoutValidation() {
  const fieldIds = [
    "cust-name",
    "cust-email",
    "cust-phone",
    "cust-address",
    "cust-city",
    "cust-state",
    "cust-zip",
  ];

  fieldIds.forEach((id) => {
    const field = document.getElementById(id);
    if (field) {
      field.classList.remove("input-error");
    }
  });
}

function validateCheckoutFields() {
  const checkoutHelper = document.getElementById("checkout-helper");
  const fields = [
    { id: "cust-name", label: "Full Name" },
    { id: "cust-email", label: "Email Address" },
    { id: "cust-phone", label: "Phone Number" },
    { id: "cust-address", label: "Street Address" },
    { id: "cust-city", label: "City" },
    { id: "cust-state", label: "State" },
    { id: "cust-zip", label: "ZIP Code" },
  ];

  clearCheckoutValidation();

  const missingFields = [];

  fields.forEach(({ id, label }) => {
    const field = document.getElementById(id);
    const value = field?.value.trim() || "";

    if (!value) {
      missingFields.push(label);
      field?.classList.add("input-error");
    }
  });

  const emailField = document.getElementById("cust-email");
  const emailValue = emailField?.value.trim() || "";
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (emailValue && !emailPattern.test(emailValue)) {
    missingFields.push("A valid Email Address");
    emailField?.classList.add("input-error");
  }

  if (checkoutHelper) {
    checkoutHelper.style.display = missingFields.length > 0 ? "block" : "none";
  }

  if (missingFields.length > 0) {
    showPaymentStatus(
      `Please complete the following before checkout:\n• ${missingFields.join("\n• ")}`,
      true,
    );
    return false;
  }

  return true;
}

function isCheckoutFormComplete() {
  const requiredIds = [
    "cust-name",
    "cust-email",
    "cust-phone",
    "cust-address",
    "cust-city",
    "cust-state",
    "cust-zip",
  ];

  const allFilled = requiredIds.every((id) => {
    const field = document.getElementById(id);
    return field && field.value.trim() !== "";
  });

  const emailValue = document.getElementById("cust-email")?.value.trim() || "";
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const emailValid = emailPattern.test(emailValue);

  const cart = getCart();
  const cartHasItems = cart.length > 0;

  return allFilled && emailValid && cartHasItems && !!squareCard;
}

function updatePayButtonAvailability() {
  const checkoutHelper = document.getElementById("checkout-helper");

  const requiredIds = [
    "cust-name",
    "cust-email",
    "cust-phone",
    "cust-address",
    "cust-city",
    "cust-state",
    "cust-zip",
  ];

  const allFieldsValid = requiredIds.every((id) => {
    const field = document.getElementById(id);
    return field && field.value.trim() !== "";
  });

  const emailField = document.getElementById("cust-email");
  const emailValue = emailField?.value.trim() || "";
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const emailValid = emailPattern.test(emailValue);

  const customerInfoValid = allFieldsValid && emailValid;

  if (checkoutHelper) {
    checkoutHelper.style.display = customerInfoValid ? "none" : "block";
  }

  // keep your existing Square/card/button logic below this
}

async function handleSquarePayment() {
  try {
    clearCheckoutValidation();

    const isValid = validateCheckoutFields();
    if (!isValid) {
      return;
    }

    setPayButtonState(true, "Processing...");
    showPaymentLoading("Processing payment...");

    const payBtn = document.getElementById("square-pay-btn");

    if (!squareCard) {
      showPaymentStatus(
        "Payment form is still loading. Please wait a moment and try again.",
      );
      return;
    }

    const cart = getCart();
    if (!cart.length) {
      showPaymentStatus("Your cart is empty.");
      return;
    }

    const total = cart.reduce((sum, item) => {
      return (
        sum + (item.price ?? getPrice(item.size, item.material, item.finish))
      );
    }, 0);

    const result = await squareCard.tokenize();

    const customer = {
      name: document.getElementById("cust-name")?.value?.trim() || "",
      email: document.getElementById("cust-email")?.value?.trim() || "",
      phone: document.getElementById("cust-phone")?.value?.trim() || "",
      address: document.getElementById("cust-address")?.value?.trim() || "",
      city: document.getElementById("cust-city")?.value?.trim() || "",
      state: document.getElementById("cust-state")?.value?.trim() || "",
      zip: document.getElementById("cust-zip")?.value?.trim() || "",
    };

    console.log("cart being sent to server =", cart);
    if (result.status !== "OK") {
      showPaymentStatus(
        "Your card details could not be verified. Please review them and try again.",
      );
      throw new Error("Card tokenization failed");
    }

    let checkoutAttemptId = sessionStorage.getItem("checkoutAttemptId");

    if (!checkoutAttemptId) {
      checkoutAttemptId = crypto.randomUUID();
      sessionStorage.setItem("checkoutAttemptId", checkoutAttemptId);
    }

    const paymentRes = await fetch("/api/payments/square", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sourceId: result.token,
        checkoutAttemptId,
        orderDetails: {
          items: cart,
          customer,
        },
      }),
    });

    console.log("Raw payment response:", paymentRes);

    if (!paymentRes.ok) {
      const errorText = await paymentRes.text();
      console.error("Payment failed response:", errorText);

      const friendlyMessage = getUserFriendlyError(errorText);

      showPaymentStatus(
        `Payment failed.\n${friendlyMessage}\n\nYour card has not been charged.`,
      );

      throw new Error("Payment request failed");
    }

    const paymentData = await paymentRes.json();
    console.log("Parsed payment data:", paymentData);

    // ✅ CLEAR IDEMPOTENCY KEY HERE
    sessionStorage.removeItem("checkoutAttemptId");

    localStorage.setItem(
      "lastOrder",
      JSON.stringify({
        paymentId: paymentData.paymentId,
        total: `$${total.toFixed(2)}`,
        items: cart,
      }),
    );

    localStorage.removeItem("cart");
    renderCart();

    window.location.href = "/success.html";
  } catch (err) {
    console.error("Square payment error:", err);
  } finally {
    setPayButtonState(false, "Pay with Card");
  }
}

function sortSizesAscending(sizeEntries) {
  return [...sizeEntries].sort(([sizeA], [sizeB]) => {
    const [aW, aH] = String(sizeA).split("x").map(Number);
    const [bW, bH] = String(sizeB).split("x").map(Number);

    const aArea = (aW || 0) * (aH || 0);
    const bArea = (bW || 0) * (bH || 0);

    return aArea - bArea;
  });
}

const SIZE_ORDER = [
  "5x7",
  "8x10",
  "11x14",
  "12x12",
  "12x18",
  "16x20",
  "20x24",
  "20x30",
  "24x36",
];

function sortSizesCustom(sizeEntries) {
  return [...sizeEntries].sort(([a], [b]) => {
    const indexA = SIZE_ORDER.indexOf(a);
    const indexB = SIZE_ORDER.indexOf(b);

    // If both are in list → use defined order
    if (indexA !== -1 && indexB !== -1) {
      return indexA - indexB;
    }

    // If only one is in list → prioritize known sizes
    if (indexA !== -1) return -1;
    if (indexB !== -1) return 1;

    // fallback (rare case)
    return a.localeCompare(b);
  });
}

window.handleUpsellClick = async function (material) {
  console.log("Upsell clicked:", material);

  // ✅ If we already have a selected photo → open modal
  if (window.lastSelectedPhoto) {
    await openFormatModal(
      window.lastSelectedPhoto.src,
      window.lastSelectedPhoto.title,
    );

    setTimeout(() => {
      const materialSelect = document.getElementById("modal-material");
      if (!materialSelect) return;

      materialSelect.value = material;
      materialSelect.dispatchEvent(new Event("change"));
    }, 50);

    return;
  }

  // ❗ If NO photo yet → send to gallery
  showPage("gallery");

  setTimeout(() => {
    alert("Select a photo first to choose print options.");
  }, 200);
};

function renderPricingCards() {
  const container =
    document.getElementById("pricing-cards") ||
    document.getElementById("pricing-grid") ||
    document.getElementById("pricing-container");

  if (!container) return;

  const materials = getPricingMaterials();

  container.innerHTML = "";
  container.style.setProperty("display", "grid", "important");
  container.style.setProperty("gap", "22px", "important");
  container.style.setProperty("align-items", "stretch", "important");

  if (window.innerWidth < 640) {
    container.style.setProperty("grid-template-columns", "1fr", "important");
  } else {
    container.style.setProperty(
      "grid-template-columns",
      "repeat(auto-fit, minmax(260px, 1fr))",
      "important",
    );
  }

  materials.forEach((material) => {
    const groupedSizes = getGroupedSizesForPricingCard(material);
    const startingPrice = getStartingPriceForMaterial(material);
    const isMostPopularMaterial = material === MOST_POPULAR_MATERIAL;
    const mostPopularSize = MOST_POPULAR_SIZE_BY_MATERIAL[material] || "";
    const upsells = getUpsellsForMaterial(material);
    const displayMaterial = MATERIAL_DISPLAY_NAMES[material] || material;

    const card = document.createElement("div");
    card.className = "pricing-card";
    card.style.display = "flex";
    card.style.flexDirection = "column";
    card.style.height = "100%";
    card.style.background = isMostPopularMaterial
      ? "linear-gradient(180deg, rgba(244,223,172,0.12) 0%, rgba(17,17,17,1) 18%)"
      : "linear-gradient(180deg, rgba(255,255,255,0.04) 0%, rgba(17,17,17,1) 18%)";
    card.style.border = isMostPopularMaterial
      ? "1px solid rgba(244,223,172,0.38)"
      : "1px solid rgba(255,255,255,0.10)";
    card.style.borderRadius = "24px";
    card.style.padding = "22px";
    card.style.color = "#fff";
    card.style.boxShadow = isMostPopularMaterial
      ? "0 16px 40px rgba(0,0,0,0.28), 0 0 0 1px rgba(244,223,172,0.08) inset"
      : "0 16px 40px rgba(0,0,0,0.20)";
    card.style.overflow = "hidden";

    const visibleSizes = groupedSizes.slice(0, 6);

    const sizeRows = visibleSizes
      .map((item) => {
        const isPopularSize = item.size === mostPopularSize;

        return `
          <div style="
            display:flex;
            justify-content:space-between;
            align-items:center;
            padding:11px 0;
            border-bottom:1px solid rgba(255,255,255,0.08);
            font-size:0.96rem;
            gap:12px;
          ">
            <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
              <span style="color:#e8e8e8;">${item.size}</span>
              ${
                isPopularSize
                  ? `
                <span style="
                  background:rgba(244,223,172,0.14);
                  color:#f4dfac;
                  border:1px solid rgba(244,223,172,0.28);
                  border-radius:999px;
                  padding:4px 8px;
                  font-size:0.68rem;
                  font-weight:800;
                  letter-spacing:0.06em;
                  text-transform:uppercase;
                ">
                  Most Popular
                </span>
              `
                  : ""
              }
            </div>

            <strong style="color:#fff; white-space:nowrap;">
              ${formatCurrency(item.basePrice)}
            </strong>
          </div>
        `;
      })
      .join("");

    const featuredSizeGroup =
      groupedSizes.find((item) => item.size === mostPopularSize) ||
      groupedSizes[0];

    const finishMessage = getRecommendedFinishMessage(
      material,
      featuredSizeGroup,
    );

    const upsellHtml = `
      <div style="
        margin-top:18px;
        padding:16px;
        border-radius:18px;
        background:rgba(255,255,255,0.035);
        border:1px solid rgba(255,255,255,0.08);
      ">
        <div style="
          font-size:0.78rem;
          letter-spacing:0.08em;
          text-transform:uppercase;
          color:#d6b36a;
          margin-bottom:12px;
          font-weight:700;
        ">
          Recommended finish
        </div>

        <div style="
          font-size:0.98rem;
          font-weight:700;
          color:#fff;
          margin-bottom:6px;
        ">
          ${featuredSizeGroup?.size || "Popular choice"}
        </div>

        <div style="
          font-size:0.92rem;
          color:#cfcfcf;
          line-height:1.5;
        ">
          ${finishMessage}
        </div>
      </div>
    `;

    const alternateMaterialHtml = upsells.length
      ? `
        <div style="
          margin-top:18px;
          padding:16px;
          border-radius:18px;
          background:rgba(255,255,255,0.035);
          border:1px solid rgba(255,255,255,0.08);
        ">
          <div style="
            font-size:0.78rem;
            letter-spacing:0.08em;
            text-transform:uppercase;
            color:#d6b36a;
            margin-bottom:12px;
            font-weight:700;
          ">
            ${UPSELL_CONFIG[material]?.label || "You may also like"}
          </div>

          ${upsells
            .map((upsell, index) => {
              const upsellStartingPrice = getStartingPriceForMaterial(
                upsell.material,
              );

              return `
                <div style="
                  padding:${index === 0 ? "0 0 12px" : "12px 0 0"};
                  ${index < upsells.length - 1 ? "border-bottom:1px solid rgba(255,255,255,0.08);" : ""}
                ">
                  <div style="
                    display:flex;
                    justify-content:space-between;
                    align-items:flex-start;
                    gap:12px;
                    margin-bottom:6px;
                  ">
                    <strong
                      onclick="handleUpsellClick('${upsell.material}')"
                      style="
                        color:#fff;
                        font-size:0.98rem;
                        line-height:1.35;
                        cursor:pointer;
                      "
                    >
                      ${upsell.title}
                    </strong>

                    <span style="
                      font-size:0.88rem;
                      color:#f4dfac;
                      white-space:nowrap;
                      font-weight:700;
                    ">
                      From ${formatCurrency(upsellStartingPrice)}
                    </span>
                  </div>

                  <div style="
                    font-size:0.92rem;
                    color:#cfcfcf;
                    line-height:1.5;
                  ">
                    ${upsell.description}
                  </div>
                </div>
              `;
            })
            .join("")}
        </div>
      `
      : "";

    card.innerHTML = `
      <div style="
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:12px;
        margin-bottom:10px;
      ">
        <div style="
          font-size:1.35rem;
          font-weight:800;
          line-height:1.2;
        ">
          ${displayMaterial}
        </div>

        ${
          isMostPopularMaterial
            ? `
          <div style="
            background:linear-gradient(180deg,#f4dfac,#d6b36a);
            color:#171717;
            border-radius:999px;
            padding:8px 14px;
            font-size:0.74rem;
            font-weight:800;
            letter-spacing:0.08em;
            text-transform:uppercase;
            box-shadow:0 8px 20px rgba(0,0,0,0.18);
            flex-shrink:0;
          ">
            Most Popular
          </div>
        `
            : ""
        }
      </div>

      <div style="
        color:#c9c9c9;
        font-size:0.95rem;
        margin-bottom:14px;
      ">
        Starting at
        <span style="
          color:#f4dfac;
          font-size:1.1rem;
          font-weight:800;
          margin-left:4px;
        ">
          ${formatCurrency(startingPrice)}
        </span>
      </div>

      <div style="
        border-top:1px solid rgba(255,255,255,0.08);
        padding-top:4px;
        flex-grow:1;
      ">
        ${sizeRows}
      </div>

      <div style="margin-top:auto;">
        ${finishMessage ? upsellHtml : ""}
        ${alternateMaterialHtml}
      </div>
    `;

    container.appendChild(card);
  });
}

function initContactForm() {
  const form = document.getElementById("contact-form");
  if (!form) return;

  const statusEl = document.getElementById("contact-status");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const name = document.getElementById("contact-name")?.value.trim();
    const email = document.getElementById("contact-email")?.value.trim();
    const subject = document.getElementById("contact-subject")?.value.trim();
    const message = document.getElementById("contact-message")?.value.trim();

    if (!name || !email || !message) {
      if (statusEl) {
        statusEl.textContent = "Please fill in all required fields.";
        statusEl.className = "contact-status";
      }
      return;
    }

    try {
      if (statusEl) {
        statusEl.textContent = "Sending message...";
        statusEl.className = "contact-status";
      }

      const res = await fetch("/api/contact", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name, email, subject, message }),
      });

      if (!res.ok) {
        throw new Error("Failed to send message");
      }

      if (statusEl) {
        statusEl.textContent = "Message sent successfully.";
        statusEl.className = "contact-status success";
      }

      form.reset();
    } catch (err) {
      console.error("Contact form error:", err);

      if (statusEl) {
        statusEl.textContent = "Something went wrong. Please try again.";
        statusEl.className = "contact-status";
      }
    }
  });
}

/* =============================
   INIT
============================= */

/* =============================
   INIT
============================= */

document.addEventListener("DOMContentLoaded", async () => {
  await loadPricing();
  refreshFormatOptions();

  window.addEventListener("resize", () => {
    renderPricingCards();
  });

  const params = new URLSearchParams(window.location.search);
  const page = params.get("page") || "home";
  showPage(page);

  renderCart();
  renderPricingCards();
  bindPageNavigation();
  initContactForm();

  const squarePayBtn = document.getElementById("square-pay-btn");
  if (squarePayBtn) {
    squarePayBtn.addEventListener("click", handleSquarePayment);
  }

  updatePayButtonAvailability();

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

  [
    "cust-name",
    "cust-email",
    "cust-phone",
    "cust-address",
    "cust-city",
    "cust-state",
    "cust-zip",
  ].forEach((id) => {
    const field = document.getElementById(id);
    if (field) {
      field.addEventListener("input", () => {
        field.classList.remove("input-error");
        updatePayButtonAvailability();
      });
    }
  });
});
