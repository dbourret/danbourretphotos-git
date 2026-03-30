(() => {
  "use strict";

  console.log("main.js loaded");

  let cart = [];
  let galleryImages = [];
  let currentLightboxIndex = 0;
  let paypalLoaded = false;
  let paypalButtonsRendered = false;
  let squarePayments = null;
  let squareCard = null;
  let squareScriptLoaded = false;

  const pricingOptions = {
    Prints: [
      { size: "11×14", price: "$20.79" },
      { size: "12×18", price: "$23.99" },
      { size: "16×20", price: "$31.99" },
      { size: "20×30", price: "$41.59" },
      { size: "24×36", price: "$51.19" }
    ],
    Canvas: [
      { size: "8×10", price: "$63.99" },
      { size: "11×14", price: "$79.99" },
      { size: "12×12", price: "$79.99" },
      { size: "16×20", price: "$143.99" },
      { size: "20×24", price: "$239.99" },
      { size: "20×30", price: "$271.99" }
    ],
    Metal: [
      { size: "5×7", price: "$47.99" },
      { size: "8×10", price: "$59.19" },
      { size: "11×14", price: "$95.99" },
      { size: "12×12", price: "$95.99" },
      { size: "16×20", price: "$111.99" },
      { size: "20×24", price: "$159.99" },
      { size: "20×30", price: "$207.99" }
    ],
    Wood: [
      { size: "5×7", price: "$39.99" },
      { size: "8×10", price: "$63.99" },
      { size: "11×14", price: "$95.99" },
      { size: "12×12", price: "$95.99" },
      { size: "16×20", price: "$111.99" },
      { size: "20×30", price: "$159.99" }
    ]
  };

  const navLinks = document.querySelectorAll("[data-page]");
  const pageButtons = document.querySelectorAll("[data-page-target]");
  const pages = document.querySelectorAll(".page");

  const lightbox = document.getElementById("lightbox");
  const lightboxImg = document.getElementById("lightbox-img");
  const lightboxCaption = document.getElementById("lightbox-caption");
  const lightboxClose = document.getElementById("lightbox-close");
  const lightboxPrev = document.getElementById("lightbox-prev");
  const lightboxNext = document.getElementById("lightbox-next");

  const orderPhotoTitle = document.getElementById("cart-photo-title");
  const orderPhotoCategory = document.getElementById("cart-photo-category");
  const orderPhotoImage = document.getElementById("cart-photo-image");
  const orderFormat = document.getElementById("cart-format");
  const orderSize = document.getElementById("cart-size");
  const summaryFormat = document.getElementById("summary-format");
  const summarySize = document.getElementById("summary-size");
  const summaryPrice = document.getElementById("summary-price");
  const addToCartBtn = document.getElementById("cart-order-btn");

  const cartItemsContainer = document.getElementById("cart-items");
  const cartTotalEl = document.getElementById("cart-total");
  const clearCartBtn = document.getElementById("clear-cart-btn");

  const custName = document.getElementById("cust-name");
  const custEmail = document.getElementById("cust-email");
  const custPhone = document.getElementById("cust-phone");
  const custAddress = document.getElementById("cust-address");
  const custCity = document.getElementById("cust-city");
  const custState = document.getElementById("cust-state");
  const custZip = document.getElementById("cust-zip");

  const squarePayBtn = document.getElementById("square-pay-btn");
  const squareStatus = document.getElementById("square-status");
  const copyrightYear = document.getElementById("copyright-year");

  function loadCart() {
    try {
      cart = JSON.parse(localStorage.getItem("cart") || "[]");
    } catch {
      cart = [];
    }
  }

  function saveCart() {
    localStorage.setItem("cart", JSON.stringify(cart));
  }

  function formatMoney(value) {
    return `$${Number(value).toFixed(2)}`;
  }

  function getCartTotal() {
    return cart.reduce((sum, item) => sum + item.price * (item.qty || 1), 0);
  }

  function showPage(pageName) {
    pages.forEach((page) => {
      page.classList.toggle("active", page.id === `page-${pageName}`);
    });

    navLinks.forEach((link) => {
      link.classList.toggle("active", link.dataset.page === pageName);
    });

    if (window.location.hash !== `#${pageName}`) {
      history.replaceState(null, "", `#${pageName}`);
    }

    window.scrollTo({ top: 0, behavior: "smooth" });

    if (pageName === "order") {
      renderPayPalButtons().catch(console.error);
      initSquare().catch(console.error);
    }
  }

  navLinks.forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      showPage(link.dataset.page);
    });
  });

  pageButtons.forEach((button) => {
    button.addEventListener("click", () => {
      showPage(button.dataset.pageTarget);
    });
  });

  function resetOrderSummary() {
    if (orderFormat) orderFormat.value = "";
    if (orderSize) orderSize.innerHTML = `<option value="">Select size</option>`;
    if (summaryFormat) summaryFormat.textContent = "—";
    if (summarySize) summarySize.textContent = "—";
    if (summaryPrice) summaryPrice.textContent = "—";

    if (orderPhotoImage) {
      orderPhotoImage.removeAttribute("src");
      orderPhotoImage.style.display = "none";
      orderPhotoImage.alt = "Selected photo preview";
    }

    if (orderPhotoTitle) {
      orderPhotoTitle.textContent = "Selected Photo";
    }

    if (orderPhotoCategory) {
      orderPhotoCategory.textContent = "";
    }
  }

  function populateSizeOptions(format) {
    if (!orderSize) return;

    orderSize.innerHTML = `<option value="">Select size</option>`;

    const options = pricingOptions[format] || [];
    options.forEach((item) => {
      const option = document.createElement("option");
      option.value = JSON.stringify(item);
      option.textContent = `${item.size} — ${item.price}`;
      orderSize.appendChild(option);
    });

    if (summaryFormat) summaryFormat.textContent = format || "—";
    if (summarySize) summarySize.textContent = "—";
    if (summaryPrice) summaryPrice.textContent = "—";
  }

  orderFormat?.addEventListener("change", () => {
    populateSizeOptions(orderFormat.value);
  });

  orderSize?.addEventListener("change", () => {
    if (!orderSize.value) {
      if (summarySize) summarySize.textContent = "—";
      if (summaryPrice) summaryPrice.textContent = "—";
      return;
    }

    const selected = JSON.parse(orderSize.value);
    if (summarySize) summarySize.textContent = selected.size;
    if (summaryPrice) summaryPrice.textContent = selected.price;
  });

  function getCustomer() {
    return {
      name: custName?.value.trim() || "",
      email: custEmail?.value.trim() || "",
      phone: custPhone?.value.trim() || "",
      address: custAddress?.value.trim() || "",
      city: custCity?.value.trim() || "",
      state: custState?.value.trim() || "",
      zip: custZip?.value.trim() || ""
    };
  }

  function validateCheckout() {
    const c = getCustomer();

    if (!c.name || !c.email || !c.address || !c.city || !c.state || !c.zip) {
      alert("Please complete checkout form");
      return false;
    }

    if (cart.length === 0) {
      alert("Cart is empty");
      return false;
    }

    return true;
  }

  function renderCart() {
    if (!cartItemsContainer || !cartTotalEl) return;

    if (cart.length === 0) {
      cartItemsContainer.innerHTML = `<p class="muted">Your cart is empty.</p>`;
      cartTotalEl.textContent = "$0.00";
      paypalButtonsRendered = false;
      return;
    }

    cartItemsContainer.innerHTML = cart.map((item) => `
      <div class="cart-item">
        <img src="${item.image}" alt="${item.photo}">
        <div class="cart-item-details">
          <strong>${item.photo}</strong><br>
          ${item.format} · ${item.size}<br>
          ${formatMoney(item.price)}
        </div>
        <div class="cart-item-actions">
          <input
            type="number"
            min="1"
            value="${item.qty || 1}"
            data-id="${item.id}"
            class="qty-input"
          >
          <button type="button" data-id="${item.id}" class="remove-btn">Remove</button>
        </div>
      </div>
    `).join("");

    cartTotalEl.textContent = formatMoney(getCartTotal());

    document.querySelectorAll(".qty-input").forEach((input) => {
      input.addEventListener("change", () => {
        const item = cart.find((i) => i.id === Number(input.dataset.id));
        if (!item) return;

        item.qty = Math.max(1, parseInt(input.value, 10) || 1);
        saveCart();
        renderCart();
        paypalButtonsRendered = false;
        renderPayPalButtons().catch(console.error);
      });
    });

    document.querySelectorAll(".remove-btn").forEach((button) => {
      button.addEventListener("click", () => {
        cart = cart.filter((item) => item.id !== Number(button.dataset.id));
        saveCart();
        renderCart();
        paypalButtonsRendered = false;
        renderPayPalButtons().catch(console.error);
      });
    });
  }

  addToCartBtn?.addEventListener("click", () => {
    const photo = orderPhotoTitle?.textContent || "";
    const category = orderPhotoCategory?.textContent || "";
    const format = orderFormat?.value || "";
    const selected = orderSize?.value ? JSON.parse(orderSize.value) : null;
    const image = orderPhotoImage?.src || "";

    if (!photo || photo === "Selected Photo" || !format || !selected || !image) {
      alert("Please choose a photo, format, and size before adding to cart.");
      return;
    }

    cart.push({
      id: Date.now(),
      photo,
      category,
      format,
      size: selected.size,
      price: parseFloat(selected.price.replace("$", "")),
      image,
      qty: 1
    });

    saveCart();
    renderCart();
    paypalButtonsRendered = false;
    renderPayPalButtons().catch(console.error);
    alert("Added to cart.");
  });

  clearCartBtn?.addEventListener("click", () => {
    cart = [];
    saveCart();
    renderCart();
    paypalButtonsRendered = false;
    renderPayPalButtons().catch(console.error);
  });

  function openLightbox(index) {
    if (!lightbox || !lightboxImg || galleryImages.length === 0) return;

    currentLightboxIndex = index;
    const current = galleryImages[currentLightboxIndex];

    lightbox.classList.add("open");
    lightboxImg.src = current.src;
    lightboxImg.alt = current.alt || "Preview";

    if (lightboxCaption) {
      lightboxCaption.textContent = current.dataset.caption || current.alt || "";
    }
  }

  function closeLightbox() {
    lightbox?.classList.remove("open");
  }

  function moveLightbox(direction) {
    if (galleryImages.length === 0) return;
    currentLightboxIndex = (currentLightboxIndex + direction + galleryImages.length) % galleryImages.length;
    openLightbox(currentLightboxIndex);
  }

  lightboxClose?.addEventListener("click", closeLightbox);
  lightboxPrev?.addEventListener("click", () => moveLightbox(-1));
  lightboxNext?.addEventListener("click", () => moveLightbox(1));

  lightbox?.addEventListener("click", (event) => {
    if (event.target === lightbox) {
      closeLightbox();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (!lightbox?.classList.contains("open")) return;

    if (event.key === "Escape") closeLightbox();
    if (event.key === "ArrowLeft") moveLightbox(-1);
    if (event.key === "ArrowRight") moveLightbox(1);
  });

  document.addEventListener("DOMContentLoaded", function () {
  const container = document.getElementById("paypal-button-container");

  console.log("paypal:", window.paypal);
  console.log("container:", container);

  if (!window.paypal) {
    console.error("PayPal SDK not loaded.");
    return;
  }

  if (!container) {
    console.error("PayPal container not found.");
    return;
  }

  paypal.Buttons({
    style: {
      layout: "vertical",
      shape: "rect",
      label: "paypal",
      height: 40
    },

    createOrder: function (data, actions) {
      return actions.order.create({
        purchase_units: [
          {
            amount: {
              value: "10.00"
            }
          }
        ]
      });
    },

    onApprove: function (data, actions) {
      return actions.order.capture().then(function (details) {
        alert("Transaction completed by " + details.payer.name.given_name);
      });
    },

    onError: function (err) {
      console.error("PayPal error:", err);
    }
  }).render("#paypal-button-container")
    .then(function () {
      console.log("PayPal button rendered.");
    })
    .catch(function (err) {
      console.error("Render failed:", err);
    });
});
  async function loadScriptOnce(src) {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) return;

    await new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  async function renderPayPalButtons() {
    const container = document.getElementById("paypal-button-container");
    if (!container) return;

    container.innerHTML = "";

    if (cart.length === 0) return;

    const config = await fetch("/api/config/paypal").then((r) => r.json());
    if (!config.clientId) return;

    if (!paypalLoaded) {
      await loadScriptOnce(`https://www.paypal.com/sdk/js?client-id=${config.clientId}&currency=USD`);
      paypalLoaded = true;
    }

    if (!window.paypal || paypalButtonsRendered) return;

    await window.paypal.Buttons({
      createOrder: async () => {
        if (!validateCheckout()) {
          throw new Error("Checkout form incomplete");
        }

        const res = await fetch("/api/paypal/create-order", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cart,
            customer: getCustomer()
          })
        });

        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || "Could not create PayPal order");
        }

        return data.id;
      },

      onApprove: async (data) => {
        const res = await fetch(`/api/paypal/capture-order/${data.orderID}`, {
          method: "POST"
        });

        const capture = await res.json();

        if (!res.ok) {
          alert(capture.error || "PayPal payment failed.");
          return;
        }

        alert("PayPal success!");
        cart = [];
        saveCart();
        renderCart();
        paypalButtonsRendered = false;
      },

      onError: (err) => {
        console.error(err);
        alert("PayPal error");
      }
    }).render("#paypal-button-container");

    paypalButtonsRendered = true;
  }

  async function initSquare() {
    const config = await fetch("/api/config/square").then((r) => r.json());

    if (!config.appId || !config.locationId) return;

    const squareScriptUrl = config.appId.startsWith("sandbox-")
      ? "https://sandbox.web.squarecdn.com/v1/square.js"
      : "https://web.squarecdn.com/v1/square.js";

    if (!squareScriptLoaded) {
      await loadScriptOnce(squareScriptUrl);
      squareScriptLoaded = true;
    }

    if (!squarePayments) {
      squarePayments = window.Square.payments(config.appId, config.locationId);
    }

    if (!squareCard) {
      squareCard = await squarePayments.card();
      await squareCard.attach("#card-container");
    }
  }

  squarePayBtn?.addEventListener("click", async () => {
    try {
      if (!validateCheckout()) return;

      await initSquare();

      if (!squareCard) {
        throw new Error("Square card form not initialized.");
      }

      if (squareStatus) squareStatus.textContent = "Processing payment...";

      const result = await squareCard.tokenize();

      if (result.status !== "OK") {
        throw new Error("Card error");
      }

      const res = await fetch("/api/square/payment", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          sourceId: result.token,
          cart,
          customer: getCustomer()
        })
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Square payment failed.");
      }

      alert("Square payment success!");
      cart = [];
      saveCart();
      renderCart();
      if (squareStatus) squareStatus.textContent = "Payment successful.";
    } catch (error) {
      console.error(error);
      if (squareStatus) squareStatus.textContent = error.message || "Payment failed.";
      alert(error.message || "Payment failed.");
    }
  });

  const App = {
    registerGallery(items) {
      galleryImages = items;
    },

    openOrderFromGallery(photo) {
      if (orderPhotoTitle) orderPhotoTitle.textContent = photo.title || "Selected Photo";
      if (orderPhotoCategory) orderPhotoCategory.textContent = photo.category || "";

      if (orderPhotoImage) {
        if (photo.src) {
          orderPhotoImage.src = photo.src;
          orderPhotoImage.alt = photo.title || "Selected photo";
          orderPhotoImage.style.display = "block";
        } else {
          orderPhotoImage.removeAttribute("src");
          orderPhotoImage.style.display = "none";
        }
      }

      resetOrderSummary();

      if (orderPhotoTitle) orderPhotoTitle.textContent = photo.title || "Selected Photo";
      if (orderPhotoCategory) orderPhotoCategory.textContent = photo.category || "";

      if (orderPhotoImage && photo.src) {
        orderPhotoImage.src = photo.src;
        orderPhotoImage.alt = photo.title || "Selected photo";
        orderPhotoImage.style.display = "block";
      }

      showPage("order");
    },

    buyNowFromGallery(photo) {
      const item = {
        id: Date.now(),
        photo: photo.title || "Selected Photo",
        category: photo.category || "",
        format: "Prints",
        size: "11×14",
        price: 20.79,
        image: photo.src || "",
        qty: 1
      };

      cart = [item];
      saveCart();
      renderCart();
      paypalButtonsRendered = false;

      if (orderPhotoTitle) orderPhotoTitle.textContent = item.photo;
      if (orderPhotoCategory) orderPhotoCategory.textContent = item.category;

      if (orderPhotoImage) {
        if (item.image) {
          orderPhotoImage.src = item.image;
          orderPhotoImage.alt = item.photo;
          orderPhotoImage.style.display = "block";
        } else {
          orderPhotoImage.removeAttribute("src");
          orderPhotoImage.style.display = "none";
        }
      }

      resetOrderSummary();

      if (orderPhotoTitle) orderPhotoTitle.textContent = item.photo;
      if (orderPhotoCategory) orderPhotoCategory.textContent = item.category;

      if (orderPhotoImage && item.image) {
        orderPhotoImage.src = item.image;
        orderPhotoImage.alt = item.photo;
        orderPhotoImage.style.display = "block";
      }

      if (orderFormat) {
        orderFormat.value = "Prints";
        populateSizeOptions("Prints");
      }

      if (summaryFormat) summaryFormat.textContent = "Prints";
      if (summarySize) summarySize.textContent = "11×14";
      if (summaryPrice) summaryPrice.textContent = "$20.79";

      showPage("order");
    },

    openLightboxByIndex(index) {
      openLightbox(index);
    }
  };

  window.App = App;

  loadCart();
  renderCart();

  if (copyrightYear) {
    copyrightYear.textContent = new Date().getFullYear();
  }

  const initialPage = (window.location.hash || "#home").replace("#", "");
  const validPages = ["home", "gallery", "pricing", "contact", "order"];
  showPage(validPages.includes(initialPage) ? initialPage : "home");
})();