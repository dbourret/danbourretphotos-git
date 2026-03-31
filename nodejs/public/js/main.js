(() => {
  "use strict";

  console.log("main.js loaded");

  let cart = [];
  let galleryImages = [];
  let currentLightboxIndex = 0;

  let squarePayments = null;
  let squareCard = null;
  let squareInitPromise = null;
  let squareConfig = null;

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

  function setSquareStatus(message) {
    const statusContainer = document.getElementById("payment-status-container");
    if (statusContainer) {
      statusContainer.textContent = message || "";
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

  function renderCart() {
    if (!cartItemsContainer || !cartTotalEl) return;

    if (cart.length === 0) {
      cartItemsContainer.innerHTML = `<p class="muted">Your cart is empty.</p>`;
      cartTotalEl.textContent = "$0.00";
      setSquareStatus("");
      return;
    }

    cartItemsContainer.innerHTML = cart
      .map(
        (item) => `
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
    `
      )
      .join("");

    cartTotalEl.textContent = formatMoney(getCartTotal());

    document.querySelectorAll(".qty-input").forEach((input) => {
      input.addEventListener("change", () => {
        const item = cart.find((i) => i.id === Number(input.dataset.id));
        if (!item) return;

        item.qty = Math.max(1, parseInt(input.value, 10) || 1);
        saveCart();
        renderCart();
      });
    });

    document.querySelectorAll(".remove-btn").forEach((button) => {
      button.addEventListener("click", () => {
        cart = cart.filter((item) => item.id !== Number(button.dataset.id));
        saveCart();
        renderCart();
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
    alert("Added to cart.");
  });

  clearCartBtn?.addEventListener("click", () => {
    cart = [];
    saveCart();
    renderCart();
    setSquareStatus("");
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
    currentLightboxIndex =
      (currentLightboxIndex + direction + galleryImages.length) % galleryImages.length;
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

  async function getSquareConfig() {
    if (squareConfig) return squareConfig;

    let res;
    try {
      res = await fetch("/api/config/square", {
        method: "GET",
        headers: { Accept: "application/json" }
      });
    } catch {
      throw new Error("Could not reach Square config endpoint");
    }

    let data = {};
    try {
      data = await res.json();
    } catch {
      throw new Error("Square config endpoint did not return valid JSON");
    }

    if (!res.ok || !data.appId || !data.locationId) {
      throw new Error(data.error || "Missing Square config");
    }

    squareConfig = {
      appId: data.appId,
      locationId: data.locationId
    };

    return squareConfig;
  }

  async function destroySquareCard() {
    if (squareCard) {
      try {
        await squareCard.destroy();
      } catch (err) {
        console.warn("Could not destroy existing Square card instance:", err);
      }
      squareCard = null;
    }
  }

  async function initSquare() {
    if (squareInitPromise) return squareInitPromise;

    squareInitPromise = (async () => {
      const cardContainer = document.getElementById("card-container");
      const originalCardButton = document.getElementById("card-button");
      const statusContainer = document.getElementById("payment-status-container");

      if (!cardContainer || !originalCardButton || !statusContainer) {
        squareInitPromise = null;
        return null;
      }

      setSquareStatus("");

      if (!window.Square) {
        console.error("Square.js failed to load");
        setSquareStatus("Payment form unavailable. Please refresh.");
        squarePayments = null;
        await destroySquareCard();
        squareInitPromise = null;
        return null;
      }

      try {
        const config = await getSquareConfig();

        squarePayments = window.Square.payments(config.appId, config.locationId);

        await destroySquareCard();

        cardContainer.innerHTML = "";
        squareCard = await squarePayments.card();
        await squareCard.attach("#card-container");

        const newButton = originalCardButton.cloneNode(true);
        originalCardButton.parentNode.replaceChild(newButton, originalCardButton);

        newButton.addEventListener("click", async () => {
          try {
            if (!validateCheckout()) return;
            if (!squareCard) throw new Error("Card is not initialized");

            newButton.disabled = true;
            setSquareStatus("Processing payment...");

            const result = await squareCard.tokenize();

            if (result.status !== "OK") {
              console.error("Square tokenization details:", result);
              throw new Error(result.errors?.[0]?.message || "Tokenization failed");
            }

            const res = await fetch("/api/square/create-payment", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                sourceId: result.token,
                cart,
                customer: getCustomer()
              })
            });

            let data = {};
            try {
              data = await res.json();
            } catch {
              throw new Error("Payment endpoint did not return valid JSON");
            }

            if (!res.ok) {
              throw new Error(data.error || "Square payment failed");
            }

            // Clear cart
            localStorage.removeItem("cart");
            window.location.href = "/success.html";

          // Redirect to success page
            window.location.href = "/success.html";
          } catch (err) {
            console.error("Square payment error:", err);
            setSquareStatus(err.message || "Payment failed.");
          } finally {
            newButton.disabled = false;
          }
        });

        squareInitPromise = null;
        return squareCard;
      } catch (err) {
        console.error("Square init failed:", err);
        setSquareStatus(err.message || "Payment form unavailable.");
        squarePayments = null;
        await destroySquareCard();
        squareInitPromise = null;
        return null;
      }
    })();

    return squareInitPromise;
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
      requestAnimationFrame(() => {
        initSquare().catch((err) => {
          console.error("Square init error:", err);
          setSquareStatus(err.message || "Payment form unavailable.");
        });
      });
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

      if (orderFormat) orderFormat.value = "";
      populateSizeOptions("");

      if (summaryFormat) summaryFormat.textContent = "—";
      if (summarySize) summarySize.textContent = "—";
      if (summaryPrice) summaryPrice.textContent = "—";

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

  document.addEventListener("DOMContentLoaded", () => {
    loadCart();
    renderCart();

    if (copyrightYear) {
      copyrightYear.textContent = new Date().getFullYear();
    }

    const initialPage = (window.location.hash || "#home").replace("#", "");
    const validPages = ["home", "gallery", "pricing", "contact", "order"];
    const pageToShow = validPages.includes(initialPage) ? initialPage : "home";

    showPage(pageToShow);
  });
})();