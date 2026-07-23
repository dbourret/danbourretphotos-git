require("dotenv").config();

const multer = require("multer");

const path = require("path");
const {
  fulfillOrderWithWhcc,
  getWhccAccessToken,
  verifyS3ObjectExists,
} = require("./whcc");

console.log("DB_HOST =", process.env.DB_HOST);
console.log("DB_USER =", process.env.DB_USER);
console.log("DB_PASSWORD exists =", !!process.env.DB_PASSWORD);
console.log("DB_NAME =", process.env.DB_NAME);

console.log("SMTP_HOST =", process.env.SMTP_HOST);
console.log("SMTP_PORT =", process.env.SMTP_PORT);
console.log("SMTP_USER =", process.env.SMTP_USER);
console.log("SMTP_PASS exists =", !!process.env.SMTP_PASS);
console.log("[SQUARE CONFIG CHECK]", {
  squareEnvironment: process.env.SQUARE_ENVIRONMENT,
  appIdPrefix: process.env.SQUARE_APP_ID?.slice(0, 12) || null,
  locationId: process.env.SQUARE_LOCATION_ID || null,
});
console.log("[ENV CHECK]", {
  nodeEnv: process.env.NODE_ENV || null,
  squareEnvironment: process.env.SQUARE_ENVIRONMENT || null,
  hasSquareAppId: !!process.env.SQUARE_APP_ID,
  hasSquareLocationId: !!process.env.SQUARE_LOCATION_ID,
  hasSquareAccessToken: !!process.env.SQUARE_ACCESS_TOKEN,
  paypalEnvironment: process.env.PAYPAL_ENVIRONMENT || null,
  hasPayPalClientId: !!process.env.PAYPAL_CLIENT_ID,
  hasPayPalClientSecret: !!process.env.PAYPAL_CLIENT_SECRET,
  hasWhccConsumerKey: !!process.env.WHCC_CONSUMER_KEY,
  hasWhccConsumerSecret: !!process.env.WHCC_CONSUMER_SECRET,
  hasDbHost: !!process.env.DB_HOST,
  hasDbUser: !!process.env.DB_USER,
  hasDbName: !!process.env.DB_NAME,
});

const MATERIAL_DB_MAP = {
  poster: "Poster",
  metal: "Metal",
  wood: "Wood",
  canvas: "Canvas",
};

// ----------------------------------
// Debug logging helpers
// ----------------------------------
const DEBUG_ORDERS = true;
const DEBUG_WHCC = true;
const DEBUG_EMAIL = true;

function logOrder(...args) {
  if (DEBUG_ORDERS) console.log(...args);
}

function logWhcc(...args) {
  if (DEBUG_WHCC) console.log(...args);
}

function logEmail(...args) {
  if (DEBUG_EMAIL) console.log(...args);
}

function normalizeMaterialForDb(material = "") {
  return MATERIAL_DB_MAP[String(material).trim().toLowerCase()] || material;
}

function normalizeFinishForDb(finish = "") {
  return String(finish).trim().toLowerCase();
}

// ----------------------------------
// 2027 CALENDAR PRODUCT
// Calendar orders use Square checkout but are fulfilled manually,
// so they must not be submitted to WHCC or validated as S3 print files.
// ----------------------------------
const CALENDAR_PRODUCT_PRICE = 25;

function isCalendarItem(item = {}) {
  const material = String(item.material || "")
    .trim()
    .toLowerCase();
  const size = String(item.size || "")
    .trim()
    .toLowerCase();
  const productType = String(item.productType || "")
    .trim()
    .toLowerCase();

  return (
    productType === "calendar" || (material === "calendar" && size === "2027")
  );
}

async function fulfillOrderWithWhccOrManual(payload = {}) {
  const submittedItems = Array.isArray(payload.items) ? payload.items : [];
  const whccItems = submittedItems.filter((item) => !isCalendarItem(item));

  if (!whccItems.length) {
    logWhcc("[WHCC SKIPPED] Calendar-only order requires manual fulfillment");
    return {
      manualFulfillment: true,
      confirmationId: null,
      importResponse: { Orders: [] },
      message: "Calendar-only order; manual fulfillment required.",
    };
  }

  if (whccItems.length !== submittedItems.length) {
    logWhcc("[WHCC] Calendar item excluded from mixed-order fulfillment");
  }

  return fulfillOrderWithWhcc({
    ...payload,
    items: whccItems,
  });
}

const express = require("express");
const crypto = require("crypto");
const nodemailer = require("nodemailer");
const mysql = require("mysql2/promise");
const rateLimit = require("express-rate-limit");
const { SquareClient, SquareEnvironment, SquareError } = require("square");

const IS_PRODUCTION =
  String(process.env.NODE_ENV || "").toLowerCase() === "production";

function debugLog(...args) {
  if (!IS_PRODUCTION) {
    console.log(...args);
  }
}

function extractWhccCosts(whccResult) {
  const order = whccResult?.importResponse?.Orders?.[0];
  const products = Array.isArray(order?.Products) ? order.Products : [];

  const subtotal = Number(order?.SubTotal || 0);
  const tax = Number(order?.Tax || 0);
  const total = Number(order?.Total || 0);

  let productCost = 0;
  let shippingCost = 0;

  for (const product of products) {
    const description = String(product.ProductDescription || "").toLowerCase();
    const price = Number(product.Price || 0);

    if (description.includes("shipping")) {
      shippingCost += price;
    } else {
      productCost += price;
    }
  }

  return {
    subtotal,
    tax,
    total,
    productCost,
    shippingCost,
    raw: order || null,
  };
}

function calculateProfitMetrics(orderTotal, whccTotal) {
  const sale = Number(orderTotal || 0);
  const cost = Number(whccTotal || 0);

  const profit = sale - cost;
  const margin = sale > 0 ? (profit / sale) * 100 : 0;

  return {
    profit: Number(profit.toFixed(2)),
    margin: Number(margin.toFixed(2)),
  };
}

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const publicDir = path.join(__dirname, "public");

const db = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "danbourret_photos_local",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

(async () => {
  try {
    const connection = await db.getConnection();
    console.log("✅ MySQL connected successfully");
    connection.release();
  } catch (error) {
    console.error("❌ MySQL connection failed:", error.message);
  }
})();

console.log("__dirname =", __dirname);
console.log("publicDir =", publicDir);

app.disable("x-powered-by");

async function estimateWhccCostsFromItems(items) {
  let productCost = 0;
  let shippingCost = 0;

  for (const item of items || []) {
    // Calendars are stocked and shipped manually, not produced by WHCC.
    if (isCalendarItem(item)) {
      continue;
    }

    const material = normalizeMaterialForDb(item.material || "");
    const size = String(item.size || "").trim();
    const finish = normalizeFinishForDb(item.finish || "");

    const [rows] = await db.execute(
      `
        SELECT product_cost, shipping_cost
        FROM whcc_costs
        WHERE material = ?
          AND size = ?
          AND finish = ?
          AND active = 1
        LIMIT 1
      `,
      [material, size, finish],
    );

    if (!rows.length) {
      throw new Error(
        `Missing WHCC cost estimate for ${material} ${size} ${finish}`,
      );
    }

    productCost += Number(rows[0].product_cost || 0);
    shippingCost += Number(rows[0].shipping_cost || 0);
  }

  return {
    productCost,
    shippingCost,
    subtotal: productCost + shippingCost,
    tax: 0,
    total: productCost + shippingCost,
  };
}

function checkAdmin(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const password = authHeader.slice(7).trim();

  if (!process.env.ADMIN_PASSWORD) {
    return res.status(500).json({ error: "Admin password not configured" });
  }

  if (password !== process.env.ADMIN_PASSWORD) {
    return res.status(403).json({ error: "Forbidden" });
  }

  next();
}

const RESTORATION_MAX_FILE_SIZE = 20 * 1024 * 1024;

const restorationAllowedMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/tiff",
]);

const restorationAllowedExtensions = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".tif",
  ".tiff",
]);

const restorationUpload = multer({
  storage: multer.memoryStorage(),

  limits: {
    fileSize: RESTORATION_MAX_FILE_SIZE,
    files: 1,
  },

  fileFilter: (req, file, callback) => {
    const extension = path.extname(file.originalname || "").toLowerCase();

    const validExtension = restorationAllowedExtensions.has(extension);

    const validMime = restorationAllowedMimeTypes.has(file.mimetype);

    if (!validExtension || !validMime) {
      return callback(new Error("INVALID_RESTORATION_FILE_TYPE"));
    }

    callback(null, true);
  },
});

// ----------------------------------
// Request logging
// ----------------------------------
const DEBUG_REQUESTS = true;

app.use((req, res, next) => {
  if (!DEBUG_REQUESTS) return next();

  const url = req.url || "";

  // Only log API calls and a few important pages
  const shouldLog =
    url.startsWith("/api/") ||
    url === "/" ||
    url.startsWith("/success.html") ||
    url.startsWith("/cart.html") ||
    url.startsWith("/checkout.html");

  if (shouldLog) {
    console.log(`REQUEST: ${req.method} ${url}`);
  }

  next();
});

/* =============================
   BODY PARSING
============================= */

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

app.post("/api/whcc/webhook-test", async (req, res) => {
  console.log("===== WHCC WEBHOOK TEST RECEIVED =====");

  console.log("HEADERS:");
  console.log(JSON.stringify(req.headers, null, 2));

  // 👇 Normalize body (handles form + JSON)
  const body = req.body;

  console.log("BODY:");
  console.log(JSON.stringify(body, null, 2));

  // 🚫 IMPORTANT: Do NOT process anything yet
  // We are still in "observation mode"

  console.log("======================================");

  res.status(200).send("ok");
});

app.post("/api/whcc/webhook", async (req, res) => {
  console.log("===== WHCC WEBHOOK RECEIVED =====");

  const body = req.body;
  console.log(JSON.stringify(body, null, 2));

  try {
    // ⚠️ These field names depend on WHCC payload
    // We’ll log first, then adjust if needed
    const confirmationId =
      body?.confirmationId ||
      body?.ConfirmationId ||
      body?.confirmationID ||
      body?.ConfirmationID ||
      body?.orderId ||
      body?.OrderID ||
      body?.EntryID ||
      body?.entryId ||
      null;

    const trackingNumber = body?.trackingNumber || body?.TrackingNumber || null;

    const trackingCarrier = body?.trackingCarrier || body?.Carrier || null;

    const providedTrackingUrl = body?.trackingUrl || body?.TrackingUrl || null;

    const trackingUrl =
      providedTrackingUrl || buildTrackingUrl(trackingCarrier, trackingNumber);

    if (!confirmationId) {
      console.log("No confirmationId found in webhook");
      return res.status(200).send("ok");
    }

    // 🔍 Find matching order
    const [orders] = await db.query(
      `
      SELECT *
      FROM orders
      WHERE whcc_confirmation_id = ?
      LIMIT 1
      `,
      [confirmationId],
    );

    if (!orders.length) {
      console.log("No matching order for:", confirmationId);
      return res.status(200).send("ok");
    }

    const order = orders[0];

    console.log("Matched order:", order.id);

    // 🚫 Prevent duplicate emails
    if (order.shipped_email_sent === 1) {
      console.log("Email already sent. Skipping.");
      return res.status(200).send("ok");
    }

    // 📝 Update order with tracking info
    await db.query(
      `
      UPDATE orders
      SET
        status = 'shipped',
        tracking_number = ?,
        tracking_carrier = ?,
        tracking_url = ?,
        shipped_at = NOW()
      WHERE id = ?
      `,
      [trackingNumber, trackingCarrier, trackingUrl, order.id],
    );

    console.log("Order updated with tracking info");

    // 📧 Send email
    await sendShipmentEmail({
      order,
      trackingNumber,
      trackingUrl,
    });

    // ✅ Mark email sent
    await db.query(
      `
      UPDATE orders
      SET shipped_email_sent = 1
      WHERE id = ?
      `,
      [order.id],
    );

    console.log("Shipping email sent + recorded");

    return res.status(200).send("ok");
  } catch (err) {
    console.error("WHCC webhook error:", err);
    return res.status(500).send("error");
  }
});

/* =============================
   SECURITY / CSP
============================= */

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");

  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "script-src 'self' 'unsafe-inline' https://sandbox.web.squarecdn.com https://web.squarecdn.com https://www.paypal.com https://www.paypalobjects.com",
      "style-src 'self' 'unsafe-inline' https://sandbox.web.squarecdn.com https://web.squarecdn.com https://www.paypal.com",
      "style-src-elem 'self' 'unsafe-inline' https://sandbox.web.squarecdn.com https://web.squarecdn.com https://www.paypal.com",
      "img-src 'self' data: https: https://www.paypal.com https://www.paypalobjects.com",
      "connect-src 'self' https://sandbox.web.squarecdn.com https://web.squarecdn.com https://connect.squareupsandbox.com https://connect.squareup.com https://pci-connect.squareupsandbox.com https://pci-connect.squareup.com https://www.paypal.com https://api-m.sandbox.paypal.com https://api-m.paypal.com https://o160250.ingest.sentry.io",
      "frame-src 'self' https://sandbox.web.squarecdn.com https://web.squarecdn.com https://www.paypal.com https://www.sandbox.paypal.com",
      "font-src 'self' data: https://sandbox.web.squarecdn.com https://web.squarecdn.com",
    ].join("; "),
  );

  next();
});

/* =============================
   STATIC FILES
============================= */

app.use(express.static(publicDir, { extensions: ["html"] }));

/* =============================
   HEALTH
============================= */

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    squareEnvironment: process.env.SQUARE_ENVIRONMENT || "sandbox",
    time: new Date().toISOString(),
  });
});

/* =============================
   PRICING
============================= */

app.get("/api/pricing", checkAdmin, async (req, res) => {
  try {
    const [rows] = await db.execute(`
      SELECT id, material, size, finish, price, active
      FROM pricing
      ORDER BY material, size, finish
    `);

    res.json(rows);
  } catch (err) {
    console.error("Failed to load pricing:", err);
    res.status(500).json({ error: "Failed to load pricing." });
  }
});

app.get("/api/public-pricing", async (req, res) => {
  console.log("[HIT] /api/public-pricing");

  try {
    const [rows] = await db.execute(`
      SELECT material, size, finish, price
      FROM pricing
      WHERE active = 1
      ORDER BY material, size, finish
    `);

    console.log("[OK] /api/public-pricing rowCount =", rows.length);
    return res.json(rows);
  } catch (err) {
    console.error("[FAIL] /api/public-pricing:", err);
    return res.status(500).json({ error: "Failed to load public pricing." });
  }
});

app.get("/api/pricing/:material/:size", async (req, res) => {
  try {
    const material = String(req.params.material || "").trim();
    const size = String(req.params.size || "").trim();
    const finish = String(req.query.finish || "")
      .trim()
      .toLowerCase();

    if (!material || !size) {
      return res.status(400).json({
        error: "Material and size are required",
      });
    }

    let rows;

    if (finish) {
      [rows] = await db.execute(
        `
        SELECT
          id,
          material,
          size,
          finish,
          price,
          active
        FROM pricing
        WHERE material = ? AND size = ? AND finish = ? AND active = 1
        LIMIT 1
        `,
        [material, size, finish],
      );
    } else {
      [rows] = await db.execute(
        `
        SELECT
          id,
          material,
          size,
          finish,
          price,
          active
        FROM pricing
        WHERE material = ? AND size = ? AND active = 1
        ORDER BY price ASC
        LIMIT 1
        `,
        [material, size],
      );
    }

    if (!rows.length) {
      return res.status(404).json({
        error: "Price not found",
      });
    }

    return res.json(rows[0]);
  } catch (error) {
    console.error("Failed to fetch price:", error);

    return res.status(500).json({
      error: "Failed to fetch price",
    });
  }
});

// ✅ ✅ ✅ ADD IT HERE (TOP-LEVEL, OUTSIDE ROUTES)
async function calculateOrderTotal(items) {
  let total = 0;

  for (const item of items) {
    // The server, rather than the browser, remains the authority for price.
    if (isCalendarItem(item)) {
      total += CALENDAR_PRODUCT_PRICE;
      continue;
    }

    const rawMaterial = item.material || "";
    const rawSize = item.size || "";
    const rawFinish = item.finish || "";

    const material = normalizeMaterialForDb(rawMaterial);
    const size = String(rawSize).trim();
    const finish = normalizeFinishForDb(rawFinish);

    const [rows] = await db.execute(
      `
        SELECT price
        FROM pricing
        WHERE material = ?
          AND size = ?
          AND finish = ?
          AND active = 1
        LIMIT 1
      `,
      [material, size, finish],
    );

    if (!rows.length) {
      throw new Error(`Invalid price for ${material} ${size} ${finish}`);
    }

    const price = Number(rows[0].price);
    total += price;
  }

  return total;
}

app.post("/api/contact", async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    const email = String(req.body.email || "").trim();
    const subject = String(req.body.subject || "").trim();
    const message = String(req.body.message || "").trim();

    if (!name || !email || !message) {
      return res.status(400).json({
        error: "Name, email, and message are required.",
      });
    }

    await sendContactInquiry({
      name,
      email,
      subject,
      message,
    });

    try {
      console.log("[CONTACT SUBMISSION RECEIVED]", {
        hasName: Boolean(name),
        hasEmail: Boolean(email),
        hasSubject: Boolean(subject),
        hasMessage: Boolean(message),
      });

      await db.execute(
        `
        INSERT INTO contact_submissions (
          name,
          email,
          subject,
          message
        ) VALUES (?, ?, ?, ?)
        `,
        [name || null, email || null, subject || null, message || null],
      );

      console.log("✅ Contact submission saved to database");
    } catch (dbError) {
      console.error("❌ Failed to save contact submission to DB:", dbError);
    }

    return res.status(200).json({
      success: true,
      message: "Inquiry sent successfully.",
    });
  } catch (error) {
    console.error("Contact inquiry error:", error);

    return res.status(500).json({
      error: "Failed to send inquiry.",
    });
  }
});

/* =============================
   EMAIL
============================= */

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT) || 587,
  secure: Number(process.env.SMTP_PORT) === 465,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  pool: true, // ✅ reuse connections
  maxConnections: 1, // ✅ prevent spam connections
  maxMessages: 50, // optional
});

// run once when server starts
transporter.verify((err, success) => {
  if (err) {
    console.error("SMTP ERROR:", err);
  } else {
    console.log("SMTP server is ready");
  }
});

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatMoney(value) {
  const amount = Number(value || 0);
  return `$${amount.toFixed(2)}`;
}

function formatSelectionsForText(selections) {
  if (!Array.isArray(selections) || selections.length === 0) {
    return "No items provided";
  }

  return selections
    .map((item, index) => {
      const title =
        item.title ||
        [item.size, item.material].filter(Boolean).join(" ") ||
        "Untitled Photo";
      const size = item.size || "Not selected";
      const material = item.material || "Not selected";
      const finish = item.finish || "Not selected";
      const price =
        item.price != null
          ? typeof item.price === "number"
            ? formatMoney(item.price)
            : String(item.price)
          : "Not available";
      const image = item.image || "Not provided";

      return [
        `${index + 1}. ${title}`,
        `   Size: ${size}`,
        `   Material: ${material}`,
        `   Finish: ${finish}`,
        `   Price: ${price}`,
        `   Image: ${image}`,
      ].join("\n");
    })
    .join("\n\n");
}

function formatSelectionsForHtml(selections) {
  if (!Array.isArray(selections) || selections.length === 0) {
    return `<div style="padding:16px;border:1px solid #eadfca;border-radius:16px;background:#ffffff;font-size:14px;line-height:1.7;color:#374151;">No items provided</div>`;
  }

  return selections
    .map((item, index) => {
      const title = escapeHtml(
        item.title ||
          [item.size, item.material].filter(Boolean).join(" ") ||
          "Untitled Photo",
      );

      const size = escapeHtml(item.size || "Not specified");
      const material = escapeHtml(item.material || "Not specified");
      const finish = escapeHtml(item.finish || "Not specified");
      const price = formatMoney(Number(item.price || 0));

      // ✅ THIS IS THE NEW PART (thumbnail URL)
      const imageUrl = `https://danbourretphotos.com/images/email_thumbnails/${item.imageKey.replace(/\.[^.]+$/, "_email_thumbnails.jpg")}`;

      return `
        <div style="padding:18px;border:1px solid #eadfca;border-radius:16px;background:#ffffff;margin-bottom:18px;">
          
          <div style="font-size:16px;line-height:1.4;font-weight:700;color:#111827;margin:0 0 14px 0;">
            ${index + 1}. ${title}
          </div>

          <!-- ✅ THUMBNAIL -->
          <img
            src="${imageUrl}"
            alt="${title}"
            style="
              width:150px;
              height:auto;
              border-radius:6px;
              display:block;
              margin-bottom:12px;
            "
          />

          <div style="font-size:14px;line-height:1.8;color:#374151;">
            <div><strong>Size:</strong> ${size}</div>
            <div><strong>Material:</strong> ${material}</div>
            <div><strong>Finish:</strong> ${finish}</div>
            <div><strong>Price:</strong> ${price}</div>
          </div>
        </div>
      `;
    })
    .join("");
}

async function sendRestorationQuoteEmail({
  name,
  email,
  phone,
  photoAge,
  description,
  file,
}) {
  if (!process.env.ORDER_NOTIFY_EMAIL || !process.env.ORDER_FROM_EMAIL) {
    throw new Error(
      "Missing ORDER_NOTIFY_EMAIL or ORDER_FROM_EMAIL configuration",
    );
  }

  const receivedAt = new Date().toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });

  const safePhotoAge = photoAge || "Not provided";

  const textBody = `
New photo restoration quote request

CUSTOMER
Name: ${name}
Email: ${email}
Phone: ${phone}
Approximate Photo Age: ${safePhotoAge}

RESTORATION REQUEST
${description}

UPLOADED PHOTOGRAPH
Filename: ${file.originalname}
File Type: ${file.mimetype}
File Size: ${(file.size / 1024 / 1024).toFixed(2)} MB

Received: ${receivedAt}
  `.trim();

  const htmlBody = `
    <div style="
      margin:0;
      padding:24px;
      background:#f5f5f5;
      font-family:Arial,Helvetica,sans-serif;
      color:#111827;
    ">
      <div style="
        max-width:720px;
        margin:0 auto;
        background:#0f0f10;
        border-radius:24px;
        overflow:hidden;
        box-shadow:0 20px 60px rgba(0,0,0,0.18);
      ">

        <div style="
          padding:28px 32px;
          background:linear-gradient(180deg,#171717 0%,#101010 100%);
          border-bottom:1px solid rgba(255,255,255,0.08);
        ">
          <div style="
            font-size:12px;
            letter-spacing:0.22em;
            text-transform:uppercase;
            color:#d6b36a;
            margin-bottom:10px;
          ">
            Dan Bourret Photos
          </div>

          <h1 style="
            margin:0;
            font-size:28px;
            line-height:1.2;
            color:#ffffff;
          ">
            New Restoration Quote Request
          </h1>

          <p style="
            margin:10px 0 0;
            color:#d1d5db;
            font-size:15px;
            line-height:1.7;
          ">
            A customer submitted a photograph for restoration review.
          </p>
        </div>

        <div style="padding:28px 32px;background:#faf7f1;">

          <div style="
            padding:18px;
            border:1px solid #eadfca;
            border-radius:16px;
            background:#ffffff;
            margin-bottom:18px;
          ">
            <div style="
              font-size:12px;
              letter-spacing:0.14em;
              text-transform:uppercase;
              color:#8b7355;
              margin-bottom:10px;
            ">
              Customer
            </div>

            <div style="
              font-size:14px;
              line-height:1.8;
              color:#374151;
            ">
              <div><strong>Name:</strong> ${escapeHtml(name)}</div>
              <div><strong>Email:</strong> ${escapeHtml(email)}</div>
              <div><strong>Phone:</strong> ${escapeHtml(phone)}</div>
              <div>
                <strong>Approximate Photo Age:</strong>
                ${escapeHtml(safePhotoAge)}
              </div>
              <div><strong>Received:</strong> ${escapeHtml(receivedAt)}</div>
            </div>
          </div>

          <div style="
            padding:18px;
            border:1px solid #eadfca;
            border-radius:16px;
            background:#ffffff;
            margin-bottom:18px;
          ">
            <div style="
              font-size:12px;
              letter-spacing:0.14em;
              text-transform:uppercase;
              color:#8b7355;
              margin-bottom:10px;
            ">
              Requested Restoration
            </div>

            <div style="
              font-size:14px;
              line-height:1.8;
              color:#374151;
              white-space:pre-wrap;
            ">
              ${escapeHtml(description)}
            </div>
          </div>

          <div style="
            padding:18px;
            border:1px solid #eadfca;
            border-radius:16px;
            background:#ffffff;
          ">
            <div style="
              font-size:12px;
              letter-spacing:0.14em;
              text-transform:uppercase;
              color:#8b7355;
              margin-bottom:10px;
            ">
              Uploaded Photograph
            </div>

            <div style="
              font-size:14px;
              line-height:1.8;
              color:#374151;
            ">
              <div>
                <strong>Filename:</strong>
                ${escapeHtml(file.originalname)}
              </div>
              <div>
                <strong>File Type:</strong>
                ${escapeHtml(file.mimetype)}
              </div>
              <div>
                <strong>File Size:</strong>
                ${(file.size / 1024 / 1024).toFixed(2)} MB
              </div>
              <div style="margin-top:8px;">
                The submitted photograph is attached to this email.
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  `;

  await transporter.sendMail({
    from: `"Dan Bourret Photos" <${process.env.ORDER_FROM_EMAIL}>`,
    to: process.env.ORDER_NOTIFY_EMAIL,
    replyTo: email,
    subject: `Photo Restoration Quote Request • ${name}`,
    text: textBody,
    html: htmlBody,
    attachments: [
      {
        filename: file.originalname,
        content: file.buffer,
        contentType: file.mimetype,
      },
    ],
  });

  await transporter.sendMail({
    from: `"Dan Bourret Photos" <${process.env.ORDER_FROM_EMAIL}>`,
    to: email,
    replyTo: process.env.ORDER_NOTIFY_EMAIL,
    subject: "We received your photo restoration request",
    text: `
Hi ${name},

Thank you for submitting your photo restoration request.

Your photograph and project description have been received. I will review the image and contact you with a quote and any questions before restoration work begins.

Submitted photograph: ${file.originalname}

Thank you,
Dan Bourret Photos
  `.trim(),

    html: `
    <div style="
      margin:0;
      padding:24px;
      background:#f5f5f5;
      font-family:Arial,Helvetica,sans-serif;
      color:#111827;
    ">
      <div style="
        max-width:720px;
        margin:0 auto;
        background:#0f0f10;
        border-radius:24px;
        overflow:hidden;
        box-shadow:0 20px 60px rgba(0,0,0,0.18);
      ">

        <div style="
          padding:28px 32px;
          background:linear-gradient(180deg,#171717 0%,#101010 100%);
          border-bottom:1px solid rgba(255,255,255,0.08);
        ">
          <div style="
            font-size:12px;
            letter-spacing:0.22em;
            text-transform:uppercase;
            color:#d6b36a;
            margin-bottom:10px;
          ">
            Dan Bourret Photos
          </div>

          <h1 style="
            margin:0;
            font-size:28px;
            line-height:1.2;
            color:#ffffff;
          ">
            Restoration Request Received
          </h1>

          <p style="
            margin:10px 0 0;
            color:#d1d5db;
            font-size:15px;
            line-height:1.7;
          ">
            Thank you for submitting your photograph for review.
          </p>
        </div>

        <div style="
          padding:28px 32px;
          background:#faf7f1;
        ">
          <div style="
            padding:18px;
            border:1px solid #eadfca;
            border-radius:16px;
            background:#ffffff;
            margin-bottom:18px;
          ">
            <div style="
              font-size:14px;
              line-height:1.8;
              color:#374151;
            ">
              Hi ${escapeHtml(name)},<br><br>

              Your photograph and project description have been received.
              I will review the image and contact you with a quote and any
              questions before restoration work begins.
            </div>
          </div>

          <div style="
            padding:18px;
            border:1px solid #eadfca;
            border-radius:16px;
            background:#ffffff;
            margin-bottom:18px;
          ">
            <div style="
              font-size:12px;
              letter-spacing:0.14em;
              text-transform:uppercase;
              color:#8b7355;
              margin-bottom:10px;
            ">
              Submitted Photograph
            </div>

            <div style="
              font-size:14px;
              line-height:1.8;
              color:#374151;
            ">
              ${escapeHtml(file.originalname)}
            </div>
          </div>

          <div style="
            padding:18px;
            border:1px solid #eadfca;
            border-radius:16px;
            background:#ffffff;
          ">
            <div style="
              font-size:14px;
              line-height:1.8;
              color:#374151;
            ">
              Thank you,<br>
              Dan Bourret Photos
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
  });

  console.log("Restoration confirmation email sent to:", email);
}

async function sendContactInquiry({ name, email, subject, message }) {
  if (!process.env.ORDER_NOTIFY_EMAIL || !process.env.ORDER_FROM_EMAIL) {
    throw new Error("Missing ORDER_NOTIFY_EMAIL or ORDER_FROM_EMAIL");
  }

  const safeName = name || "Customer";
  const safeEmail = email || "Not provided";
  const safeSubject = subject || "General Inquiry";
  const safeMessage = message || "";

  const receivedAt = new Date().toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });

  const adminSubject = `Contact Inquiry • ${safeSubject}`;

  const adminTextBody = `
New contact inquiry received

Name: ${safeName}
Email: ${safeEmail}
Subject: ${safeSubject}
Received: ${receivedAt}

Message:
${safeMessage}
  `.trim();

  const adminHtmlBody = `
    <div style="margin:0;padding:24px;background:#f5f5f5;font-family:Arial,Helvetica,sans-serif;color:#111827;">
      <div style="max-width:720px;margin:0 auto;background:#0f0f10;border-radius:24px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,0.18);">

        <div style="padding:28px 32px;background:linear-gradient(180deg,#171717 0%,#101010 100%);border-bottom:1px solid rgba(255,255,255,0.08);">
          <div style="font-size:12px;letter-spacing:0.22em;text-transform:uppercase;color:#d6b36a;margin-bottom:10px;">
            Dan Bourret Photos
          </div>
          <h1 style="margin:0;font-size:28px;line-height:1.2;color:#ffffff;">
            New Contact Inquiry
          </h1>
          <p style="margin:10px 0 0;color:#d1d5db;font-size:15px;line-height:1.7;">
            A visitor submitted the contact form on your website.
          </p>
        </div>

        <div style="padding:28px 32px;background:#faf7f1;">
          <div style="padding:18px;border:1px solid #eadfca;border-radius:16px;background:#ffffff;margin-bottom:18px;">
            <div style="font-size:12px;letter-spacing:0.14em;text-transform:uppercase;color:#8b7355;margin-bottom:10px;">
              Contact Details
            </div>
            <div style="font-size:14px;line-height:1.8;color:#374151;">
              <div><strong>Name:</strong> ${escapeHtml(safeName)}</div>
              <div><strong>Email:</strong> ${escapeHtml(safeEmail)}</div>
              <div><strong>Subject:</strong> ${escapeHtml(safeSubject)}</div>
              <div><strong>Received:</strong> ${escapeHtml(receivedAt)}</div>
            </div>
          </div>

          <div style="padding:18px;border:1px solid #eadfca;border-radius:16px;background:#ffffff;">
            <div style="font-size:12px;letter-spacing:0.14em;text-transform:uppercase;color:#8b7355;margin-bottom:10px;">
              Message
            </div>
            <div style="font-size:14px;line-height:1.8;color:#374151;white-space:pre-wrap;">
              ${escapeHtml(safeMessage)}
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  await transporter.sendMail({
    from: `"Dan Bourret Photography" <${process.env.ORDER_FROM_EMAIL}>`,
    to: process.env.ORDER_NOTIFY_EMAIL,
    replyTo: safeEmail,
    subject: adminSubject,
    text: adminTextBody,
    html: adminHtmlBody,
  });

  const customerSubject = `We received your message • ${safeSubject}`;

  const customerTextBody = `
Hi ${safeName},

Thank you for reaching out to Dan Bourret Photography.

We received your message and will get back to you as soon as possible.

Submitted details:
Name: ${safeName}
Email: ${safeEmail}
Subject: ${safeSubject}
Message: ${safeMessage}

Received: ${receivedAt}

- Dan Bourret Photography
  `.trim();

  const customerHtmlBody = `
  <div style="margin:0;padding:24px;background:#f5f5f5;font-family:Arial,Helvetica,sans-serif;color:#111827;">
    <div style="max-width:720px;margin:0 auto;background:#0f0f10;border-radius:24px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,0.18);">

      <div style="padding:28px 32px;background:linear-gradient(180deg,#171717 0%,#101010 100%);border-bottom:1px solid rgba(255,255,255,0.08);">
        <div style="font-size:12px;letter-spacing:0.22em;text-transform:uppercase;color:#d6b36a;margin-bottom:10px;">
          Dan Bourret Photos
        </div>
        <h1 style="margin:0;font-size:28px;line-height:1.2;color:#ffffff;">
          Inquiry Received
        </h1>
        <p style="margin:10px 0 0;color:#d1d5db;font-size:15px;line-height:1.7;">
          Thank you for reaching out. Your message has been received, and I’ll respond as soon as possible.
        </p>
      </div>

      <div style="padding:28px 32px;background:#faf7f1;">
        <div style="padding:18px;border:1px solid #eadfca;border-radius:16px;background:#ffffff;margin-bottom:18px;">
          <div style="font-size:12px;letter-spacing:0.14em;text-transform:uppercase;color:#8b7355;margin-bottom:10px;">
            Inquiry Details
          </div>
          <div style="font-size:14px;line-height:1.8;color:#374151;">
            <div><strong>Subject:</strong> ${escapeHtml(subject || "General Inquiry")}</div>
            <div><strong>Received:</strong> ${escapeHtml(receivedAt)}</div>
          </div>
        </div>

        <div style="padding:18px;border:1px solid #eadfca;border-radius:16px;background:#ffffff;margin-bottom:18px;">
          <div style="font-size:12px;letter-spacing:0.14em;text-transform:uppercase;color:#8b7355;margin-bottom:10px;">
            Your Message
          </div>
          <div style="font-size:14px;line-height:1.8;color:#374151;white-space:pre-wrap;">
            ${escapeHtml(message || "")}
          </div>
        </div>

        <div style="padding:18px;border:1px solid #eadfca;border-radius:16px;background:#ffffff;">
          <div style="font-size:14px;line-height:1.8;color:#374151;">
            I appreciate your interest and will be in touch soon.<br><br>
            — Dan Bourret Photos
          </div>
        </div>
      </div>
    </div>
  </div>
`;

  await transporter.sendMail({
    from: `"Dan Bourret Photography" <${process.env.ORDER_FROM_EMAIL}>`,
    to: safeEmail,
    subject: customerSubject,
    html: customerHtmlBody,
  });
}
async function sendOrderNotification({
  paymentId,
  receiptUrl,
  amount,
  customer,
  selections,
  notes,
}) {
  if (!process.env.ORDER_NOTIFY_EMAIL || !process.env.ORDER_FROM_EMAIL) {
    console.warn(
      "Order email skipped: missing ORDER_NOTIFY_EMAIL or ORDER_FROM_EMAIL",
    );
    return;
  }

  const customerName = customer?.name || "Not provided";
  const customerEmail = customer?.email || "Not provided";
  const customerPhone = customer?.phone || "Not provided";
  const customerAddress = customer?.address || "Not provided";
  const customerCity = customer?.city || "Not provided";
  const customerState = customer?.state || "Not provided";
  const customerZip = customer?.zip || "Not provided";

  const totalDollars = Number(amount || 0) / 100;
  const subject = `New Print Order${paymentId ? ` • ${paymentId}` : ""}`;

  const textBody = `
New print order received

ORDER SUMMARY
Payment ID: ${paymentId || "Not available"}
Order Total: ${formatMoney(totalDollars)}
Receipt URL: ${receiptUrl || "Not available"}

CUSTOMER
Name: ${customerName}
Email: ${customerEmail}
Phone: ${customerPhone}

SHIPPING
Address: ${customerAddress}
City: ${customerCity}
State: ${customerState}
ZIP: ${customerZip}

ITEMS
${formatSelectionsForText(selections)}

NOTES
${notes || "None"}
  `.trim();

  const htmlBody = `
    <div style="margin:0;padding:24px;background:#f5f5f5;font-family:Arial,Helvetica,sans-serif;color:#111827;">
      <div style="max-width:760px;margin:0 auto;background:#0f0f10;border-radius:24px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,0.18);">
        <div style="padding:28px 32px;background:linear-gradient(180deg,#171717 0%,#101010 100%);border-bottom:1px solid rgba(255,255,255,0.08);">
          <div style="font-size:12px;letter-spacing:0.22em;text-transform:uppercase;color:#d6b36a;margin-bottom:10px;">
            Dan Bourret Photos
          </div>
          <h1 style="margin:0;font-size:28px;line-height:1.2;color:#ffffff;">
            New Print Order Received
          </h1>
          <p style="margin:10px 0 0;color:#d1d5db;font-size:15px;line-height:1.7;">
            A customer completed checkout and the order is ready for review and fulfillment.
          </p>
        </div>

        <div style="padding:28px 32px;background:#faf7f1;">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:18px;">
            <div style="padding:18px;border:1px solid #eadfca;border-radius:16px;background:#ffffff;">
              <div style="font-size:12px;letter-spacing:0.14em;text-transform:uppercase;color:#8b7355;margin-bottom:8px;">
                Payment ID
              </div>
              <div style="font-size:15px;font-weight:700;color:#111827;word-break:break-word;">
                ${escapeHtml(paymentId || "Not available")}
              </div>
            </div>

            <div style="padding:18px;border:1px solid #eadfca;border-radius:16px;background:#ffffff;">
              <div style="font-size:12px;letter-spacing:0.14em;text-transform:uppercase;color:#8b7355;margin-bottom:8px;">
                Order Total
              </div>
              <div style="font-size:15px;font-weight:700;color:#111827;">
                ${formatMoney(totalDollars)}
              </div>
            </div>
          </div>

          <div style="padding:18px;border:1px solid #eadfca;border-radius:16px;background:#ffffff;margin-bottom:18px;">
  <div style="font-size:12px;letter-spacing:0.14em;text-transform:uppercase;color:#8b7355;margin-bottom:10px;">
    Receipt
  </div>
  <div style="font-size:14px;line-height:1.8;color:#374151;">
    ${
      String(process.env.SQUARE_ENVIRONMENT || "").toLowerCase() ===
        "production" && receiptUrl
        ? `<a href="${escapeHtml(receiptUrl)}" target="_blank" rel="noopener noreferrer" style="color:#9f7a2f;text-decoration:none;font-weight:700;">View your Square receipt</a>`
        : "Receipt not available in test mode"
    }
  </div>
</div>

          <div style="padding:18px;border:1px solid #eadfca;border-radius:16px;background:#ffffff;margin-bottom:18px;">
            <div style="font-size:12px;letter-spacing:0.14em;text-transform:uppercase;color:#8b7355;margin-bottom:10px;">
              Customer
            </div>
            <div style="font-size:14px;line-height:1.8;color:#374151;">
              <div><strong>Name:</strong> ${escapeHtml(customerName)}</div>
              <div><strong>Email:</strong> ${escapeHtml(customerEmail)}</div>
              <div><strong>Phone:</strong> ${escapeHtml(customerPhone)}</div>
            </div>
          </div>

          <div style="padding:18px;border:1px solid #eadfca;border-radius:16px;background:#ffffff;margin-bottom:18px;">
            <div style="font-size:12px;letter-spacing:0.14em;text-transform:uppercase;color:#8b7355;margin-bottom:10px;">
              Shipping
            </div>
            <div style="font-size:14px;line-height:1.8;color:#374151;">
              <div><strong>Address:</strong> ${escapeHtml(customerAddress)}</div>
              <div><strong>City:</strong> ${escapeHtml(customerCity)}</div>
              <div><strong>State:</strong> ${escapeHtml(customerState)}</div>
              <div><strong>ZIP:</strong> ${escapeHtml(customerZip)}</div>
            </div>
          </div>

<div style="margin-bottom:18px;">
  <div style="font-size:12px;letter-spacing:0.14em;text-transform:uppercase;color:#8b7355;margin:0 0 10px 0;">
    Ordered Items
  </div>
  ${formatSelectionsForHtml(selections)}
</div>

          <div style="padding:18px;border:1px solid #eadfca;border-radius:16px;background:#ffffff;">
            <div style="font-size:12px;letter-spacing:0.14em;text-transform:uppercase;color:#8b7355;margin-bottom:10px;">
              Customer Notes
            </div>
            <div style="font-size:14px;line-height:1.8;color:#374151;">
              ${escapeHtml(notes || "None")}
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  console.log("About to send email...");
  console.log("ORDER_FROM_EMAIL:", process.env.ORDER_FROM_EMAIL);
  console.log("ORDER_NOTIFY_EMAIL:", process.env.ORDER_NOTIFY_EMAIL);
  console.log("Subject:", subject);

  const info = await transporter.sendMail({
    from: `"Dan Bourret Photos" <${process.env.ORDER_FROM_EMAIL}>`,
    to: process.env.ORDER_NOTIFY_EMAIL,
    replyTo:
      customer?.email && customer.email.includes("@")
        ? customer.email
        : process.env.ORDER_FROM_EMAIL,
    subject,
    text: textBody,
    html: htmlBody,
  });

  // Send confirmation email to customer
  if (customer?.email && customer.email.includes("@")) {
    const customerSubject = "Your Order Confirmation - Dan Bourret Photos";

    const customerText = `
Thank you for your order!

ORDER SUMMARY
Payment ID: ${paymentId || "Not available"}
Total: ${formatMoney(Number(amount || 0) / 100)}

We have received your order and will begin processing it shortly.

If you have any questions, reply to this email.

Thank you,
Dan Bourret Photos
  `.trim();

    const customerHtml = `
  <div style="margin:0;padding:24px;background:#f5f5f5;font-family:Arial,Helvetica,sans-serif;color:#111827;">
    <div style="max-width:720px;margin:0 auto;background:#0f0f10;border-radius:24px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,0.18);">

      <div style="padding:28px 32px;background:linear-gradient(180deg,#171717 0%,#101010 100%);border-bottom:1px solid rgba(255,255,255,0.08);">
        <div style="font-size:12px;letter-spacing:0.22em;text-transform:uppercase;color:#d6b36a;margin-bottom:10px;">
          Dan Bourret Photos
        </div>
        <h1 style="margin:0;font-size:28px;line-height:1.2;color:#ffffff;">
          Order Confirmed
        </h1>
        <p style="margin:10px 0 0;color:#d1d5db;font-size:15px;line-height:1.7;">
          Thank you for your purchase. Your order has been received and is now being processed.
        </p>
      </div>

      <div style="padding:28px 32px;background:#faf7f1;">
        <div style="padding:18px;border:1px solid #eadfca;border-radius:16px;background:#ffffff;margin-bottom:18px;">
          <div style="font-size:12px;letter-spacing:0.14em;text-transform:uppercase;color:#8b7355;margin-bottom:10px;">
            Order Summary
          </div>
          <div style="font-size:14px;line-height:1.8;color:#374151;">
            <div><strong>Payment ID:</strong> ${escapeHtml(paymentId || "Not available")}</div>
            <div><strong>Total:</strong> ${formatMoney(Number(amount || 0) / 100)}</div>
          </div>
        </div>

        <div style="padding:18px;border:1px solid #eadfca;border-radius:16px;background:#ffffff;margin-bottom:18px;">
          <div style="font-size:12px;letter-spacing:0.14em;text-transform:uppercase;color:#8b7355;margin-bottom:10px;">
            Receipt
          </div>
          <div style="font-size:14px;line-height:1.7;color:#374151;">
            ${
              String(process.env.SQUARE_ENVIRONMENT || "").toLowerCase() ===
                "production" && receiptUrl
                ? `<a href="${escapeHtml(receiptUrl)}" target="_blank" rel="noopener noreferrer" style="color:#9f7a2f;text-decoration:none;font-weight:700;">View your Square receipt</a>`
                : "Receipt not available in test mode"
            }
          </div>
        </div>

        <div style="margin-bottom:18px;">
          <div style="font-size:12px;letter-spacing:0.14em;text-transform:uppercase;color:#8b7355;margin:0 0 10px 0;">
            Ordered Items
          </div>
          ${formatSelectionsForHtml(selections)}
        </div>

        <div style="padding:18px;border:1px solid #eadfca;border-radius:16px;background:#ffffff;margin-bottom:18px;">
          <div style="font-size:12px;letter-spacing:0.14em;text-transform:uppercase;color:#8b7355;margin-bottom:10px;">
            Next Step
          </div>
          <div style="font-size:14px;line-height:1.8;color:#374151;">
            We’ll notify you when your order ships.
          </div>
        </div>

        <div style="padding:18px;border:1px solid #eadfca;border-radius:16px;background:#ffffff;">
          <div style="font-size:14px;line-height:1.8;color:#374151;">
            If you have any questions, just reply to this email.<br><br>
            — Dan Bourret Photos
          </div>
        </div>
      </div>
    </div>
  </div>
`;

    await transporter.sendMail({
      from: `"Dan Bourret Photos" <${process.env.ORDER_FROM_EMAIL}>`,
      to: customer.email,
      subject: customerSubject,
      text: customerText,
      html: customerHtml,
    });

    console.log("Customer confirmation email sent");
  }

  console.log("Email send result:", info);
  console.log("Sent to:", process.env.ORDER_NOTIFY_EMAIL);
  console.log("Sent from:", process.env.ORDER_FROM_EMAIL);
}

function buildTrackingUrl(carrier, trackingNumber) {
  if (!trackingNumber) return null;

  const normalizedCarrier = String(carrier || "")
    .trim()
    .toLowerCase();
  const encodedTracking = encodeURIComponent(trackingNumber);

  if (normalizedCarrier.includes("fedex")) {
    return `https://www.fedex.com/fedextrack/?trknbr=${encodedTracking}`;
  }

  if (normalizedCarrier.includes("ups")) {
    return `https://www.ups.com/track?tracknum=${encodedTracking}`;
  }

  if (normalizedCarrier.includes("usps")) {
    return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${encodedTracking}`;
  }

  return null;
}

async function sendShipmentEmail({ order, trackingNumber, trackingUrl }) {
  const customerEmail = order.customer_email;
  const customerName = order.customer_name || "Customer";

  if (!customerEmail) return;

  const subject = "Your order has shipped — Dan Bourret Photos";

  let itemsHtml = "";

  try {
    let items = order.items_json;

    if (typeof items === "string") {
      items = JSON.parse(items);
    }

    if (!Array.isArray(items)) {
      items = [];
    }

    if (items.length) {
      itemsHtml = items
        .map((item) => {
          const title = escapeHtml(item.title || "Photo Print");
          const material = escapeHtml(item.material || "");
          const size = escapeHtml(item.size || "");
          const finish = escapeHtml(item.finish || "");
          const imageKey = item.imageKey || "";

          const thumbnailUrl = imageKey
            ? `https://danbourretphotos.com/images/email_thumbnails/${imageKey.replace(/\.[^.]+$/, "_email_thumbnails.jpg")}`
            : "";

          return `
            <div style="padding:18px;border:1px solid #eadfca;border-radius:16px;background:#ffffff;margin-bottom:18px;">
              <div style="font-size:16px;line-height:1.4;font-weight:700;color:#111827;margin:0 0 14px 0;">
                ${title}
              </div>

              ${
                thumbnailUrl
                  ? `<img
                      src="${thumbnailUrl}"
                      alt="${title}"
                      style="width:150px;height:auto;border-radius:6px;display:block;margin-bottom:12px;"
                    />`
                  : ""
              }

              <div style="font-size:14px;line-height:1.8;color:#374151;">
                <div><strong>Material:</strong> ${material}</div>
                <div><strong>Size:</strong> ${size}</div>
                <div><strong>Finish:</strong> ${finish}</div>
              </div>
            </div>
          `;
        })
        .join("");
    }
  } catch (err) {
    console.log("Shipping email item parse error:", err);
  }

  const html = `
  <div style="margin:0;padding:24px;background:#f5f5f5;font-family:Arial,Helvetica,sans-serif;color:#111827;">
    <div style="max-width:720px;margin:0 auto;background:#0f0f10;border-radius:24px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,0.18);">

      <div style="padding:28px 32px;background:linear-gradient(180deg,#171717 0%,#101010 100%);border-bottom:1px solid rgba(255,255,255,0.08);">
        <div style="font-size:12px;letter-spacing:0.22em;text-transform:uppercase;color:#d6b36a;margin-bottom:10px;">
          Dan Bourret Photos
        </div>
        <h1 style="margin:0;font-size:28px;line-height:1.2;color:#ffffff;">
          Your Order Has Shipped
        </h1>
        <p style="margin:10px 0 0;color:#d1d5db;font-size:15px;line-height:1.7;">
          Your print is on the way and will be arriving soon.
        </p>
      </div>

      <div style="padding:28px 32px;background:#faf7f1;">

        ${
          itemsHtml
            ? `
              <div style="font-size:12px;letter-spacing:0.14em;text-transform:uppercase;color:#8b7355;margin:0 0 10px 0;">
                Shipped Item
              </div>
              ${itemsHtml}
            `
            : ""
        }

        <div style="padding:18px;border:1px solid #eadfca;border-radius:16px;background:#ffffff;margin-bottom:18px;">
          <div style="font-size:12px;letter-spacing:0.14em;text-transform:uppercase;color:#8b7355;margin-bottom:10px;">
            Shipping Details
          </div>
          <div style="font-size:14px;line-height:1.8;color:#374151;">
            <div><strong>Name:</strong> ${escapeHtml(customerName)}</div>
            ${
              trackingNumber
                ? `<div><strong>Tracking Number:</strong> ${escapeHtml(trackingNumber)}</div>`
                : ""
            }
          </div>
        </div>

        ${
          trackingUrl
            ? `
              <div style="text-align:center;margin-bottom:18px;">
                <a href="${escapeHtml(trackingUrl)}" target="_blank" rel="noopener noreferrer"
                  style="display:inline-block;padding:12px 20px;background:#111827;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:700;">
                  Track Your Shipment
                </a>
              </div>
            `
            : ""
        }

        <div style="padding:18px;border:1px solid #eadfca;border-radius:16px;background:#ffffff;">
          <div style="font-size:14px;line-height:1.8;color:#374151;">
            Thank you again for your order.<br><br>
            If you have any questions, just reply to this email.<br><br>
            — Dan Bourret Photos
          </div>
        </div>

      </div>
    </div>
  </div>
  `;

  await transporter.sendMail({
    from: `"Dan Bourret Photos" <${process.env.ORDER_FROM_EMAIL}>`,
    to: customerEmail,
    subject,
    html,
  });

  console.log("Branded shipping email sent to:", customerEmail);
}

/* =============================
   SQUARE CLIENT
============================= */

const squareEnvironment =
  String(process.env.SQUARE_ENVIRONMENT || "").toLowerCase() === "production"
    ? SquareEnvironment.Production
    : SquareEnvironment.Sandbox;

const squareClient = new SquareClient({
  token: process.env.SQUARE_ACCESS_TOKEN,
  environment: squareEnvironment,
});

/* =============================
   SQUARE CONFIG
============================= */

async function getSquarePayment(paymentId) {
  const paymentResponse = await squareClient.payments.get({
    paymentId,
  });

  return paymentResponse.result?.payment || paymentResponse.payment || null;
}

app.get("/api/config/square", (req, res) => {
  console.log("[HIT] /api/config/square");

  const appId = process.env.SQUARE_APP_ID;
  const locationId = process.env.SQUARE_LOCATION_ID;
  const environment = String(
    process.env.SQUARE_ENVIRONMENT || "sandbox",
  ).toLowerCase();

  console.log("[SQUARE CONFIG CHECK]", {
    hasAppId: !!appId,
    hasLocationId: !!locationId,
    environment,
  });

  if (!appId || !locationId) {
    console.error("[FAIL] /api/config/square missing env");
    return res.status(500).json({
      error:
        "Missing Square configuration. Check SQUARE_APP_ID and SQUARE_LOCATION_ID.",
    });
  }

  return res.json({
    appId,
    locationId,
    environment,
    scriptUrl:
      environment === "production"
        ? "https://web.squarecdn.com/v1/square.js"
        : "https://sandbox.web.squarecdn.com/v1/square.js",
  });
});


/* =============================
   PAYPAL CONFIG / CLIENT
============================= */

const PAYPAL_ENVIRONMENT =
  String(process.env.PAYPAL_ENVIRONMENT || "sandbox").toLowerCase() === "live" ||
  String(process.env.PAYPAL_ENVIRONMENT || "sandbox").toLowerCase() ===
    "production"
    ? "live"
    : "sandbox";

const PAYPAL_API_BASE =
  PAYPAL_ENVIRONMENT === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";

async function getPayPalAccessToken() {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("PayPal credentials are not configured");
  }

  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString(
    "base64",
  );

  const response = await fetch(`${PAYPAL_API_BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data.access_token) {
    throw new Error(
      data.error_description || data.error || "Unable to authenticate PayPal",
    );
  }

  return data.access_token;
}

async function callPayPalApi(pathname, options = {}) {
  const accessToken = await getPayPalAccessToken();
  const response = await fetch(`${PAYPAL_API_BASE}${pathname}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  const text = await response.text();
  let data = {};

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    const details =
      data?.details?.[0]?.description ||
      data?.details?.[0]?.issue ||
      data?.message ||
      data?.name ||
      `PayPal request failed with status ${response.status}`;
    const error = new Error(details);
    error.status = response.status;
    error.paypal = data;
    throw error;
  }

  return data;
}

async function verifyCheckoutAssets(items = []) {
  for (const item of items) {
    if (isCalendarItem(item)) {
      logOrder("[S3 SKIPPED] Calendar item uses manual fulfillment");
      continue;
    }

    const exists = await verifyS3ObjectExists(
      process.env.S3_BUCKET_NAME,
      item.imageKey,
    );

    if (!exists) {
      throw new Error(`Image not found: ${item.imageKey}`);
    }
  }
}

function normalizePayPalState(value = "") {
  const raw = String(value).trim().toUpperCase();

  if (/^[A-Z]{2}$/.test(raw)) {
    return raw;
  }

  const stateCodes = {
    ALABAMA: "AL",
    ALASKA: "AK",
    ARIZONA: "AZ",
    ARKANSAS: "AR",
    CALIFORNIA: "CA",
    COLORADO: "CO",
    CONNECTICUT: "CT",
    DELAWARE: "DE",
    FLORIDA: "FL",
    GEORGIA: "GA",
    HAWAII: "HI",
    IDAHO: "ID",
    ILLINOIS: "IL",
    INDIANA: "IN",
    IOWA: "IA",
    KANSAS: "KS",
    KENTUCKY: "KY",
    LOUISIANA: "LA",
    MAINE: "ME",
    MARYLAND: "MD",
    MASSACHUSETTS: "MA",
    MICHIGAN: "MI",
    MINNESOTA: "MN",
    MISSISSIPPI: "MS",
    MISSOURI: "MO",
    MONTANA: "MT",
    NEBRASKA: "NE",
    NEVADA: "NV",
    "NEW HAMPSHIRE": "NH",
    "NEW JERSEY": "NJ",
    "NEW MEXICO": "NM",
    "NEW YORK": "NY",
    "NORTH CAROLINA": "NC",
    "NORTH DAKOTA": "ND",
    OHIO: "OH",
    OKLAHOMA: "OK",
    OREGON: "OR",
    PENNSYLVANIA: "PA",
    "RHODE ISLAND": "RI",
    "SOUTH CAROLINA": "SC",
    "SOUTH DAKOTA": "SD",
    TENNESSEE: "TN",
    TEXAS: "TX",
    UTAH: "UT",
    VERMONT: "VT",
    VIRGINIA: "VA",
    WASHINGTON: "WA",
    "WEST VIRGINIA": "WV",
    WISCONSIN: "WI",
    WYOMING: "WY",
    "DISTRICT OF COLUMBIA": "DC",
  };

  return stateCodes[raw] || raw.slice(0, 2);
}

function buildPayPalShipping(customer = {}) {
  return {
    name: {
      full_name: String(customer.name || "").trim(),
    },
    address: {
      address_line_1: String(customer.address || "").trim(),
      admin_area_2: String(customer.city || "").trim(),
      admin_area_1: normalizePayPalState(customer.state),
      postal_code: String(customer.zip || "").trim(),
      country_code: "US",
    },
  };
}

app.get("/api/config/paypal", (req, res) => {
  const clientId = process.env.PAYPAL_CLIENT_ID || "";
  const enabled = Boolean(clientId && process.env.PAYPAL_CLIENT_SECRET);

  return res.json({
    enabled,
    clientId: enabled ? clientId : null,
    environment: PAYPAL_ENVIRONMENT,
    scriptUrl: "https://www.paypal.com/sdk/js",
  });
});

app.post("/api/payments/paypal/create", async (req, res) => {
  try {
    const { orderDetails = {}, checkoutAttemptId } = req.body;
    const items = Array.isArray(orderDetails.items) ? orderDetails.items : [];
    const customer = orderDetails.customer || {};

    if (!items.length) {
      return res.status(400).json({ error: "Your cart is empty." });
    }

    if (!customer.name || !customer.email || !customer.address) {
      return res.status(400).json({
        error: "Complete your contact and shipping information first.",
      });
    }

    await verifyCheckoutAssets(items);

    const calculatedTotal = await calculateOrderTotal(items);
    const paypalOrder = await callPayPalApi("/v2/checkout/orders", {
      method: "POST",
      headers: {
        "PayPal-Request-Id":
          checkoutAttemptId || `dbp-create-${crypto.randomUUID()}`,
      },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [
          {
            reference_id: `dbp-${Date.now()}`,
            description: "Dan Bourret Photos order",
            custom_id: crypto.randomUUID(),
            amount: {
              currency_code: "USD",
              value: calculatedTotal.toFixed(2),
            },
            shipping: buildPayPalShipping(customer),
          },
        ],
        payment_source: {
          paypal: {
            experience_context: {
              brand_name: "Dan Bourret Photos",
              user_action: "PAY_NOW",
              shipping_preference: "SET_PROVIDED_ADDRESS",
            },
          },
        },
      }),
    });

    return res.json({
      orderId: paypalOrder.id,
      status: paypalOrder.status,
      amount: calculatedTotal.toFixed(2),
    });
  } catch (error) {
    console.error("PayPal order creation error:", error);
    return res.status(error.status || 500).json({
      error: error.message || "Unable to create PayPal order",
    });
  }
});

app.post("/api/payments/paypal/:orderId/capture", async (req, res) => {
  const paypalOrderId = String(req.params.orderId || "").trim();

  try {
    const orderDetails = req.body.orderDetails || {};
    const items = Array.isArray(orderDetails.items) ? orderDetails.items : [];
    const customer = orderDetails.customer || {};

    if (!paypalOrderId || !items.length) {
      return res.status(400).json({ error: "Invalid PayPal order." });
    }

    const providerOrderId = `paypal:${paypalOrderId}`;

    const [existingOrders] = await db.execute(
      `
        SELECT square_payment_id, status
        FROM orders
        WHERE square_order_id = ?
        LIMIT 1
      `,
      [providerOrderId],
    );

    if (existingOrders.length && existingOrders[0].status === "paid") {
      return res.json({
        success: true,
        orderId: paypalOrderId,
        captureId: String(existingOrders[0].square_payment_id || "").replace(
          /^paypal:/,
          "",
        ),
        status: "COMPLETED",
        duplicate: true,
      });
    }

    await verifyCheckoutAssets(items);
    const calculatedTotal = await calculateOrderTotal(items);

    let capturedOrder;

    try {
      capturedOrder = await callPayPalApi(
        `/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}/capture`,
        {
          method: "POST",
          headers: {
            "PayPal-Request-Id": `dbp-capture-${paypalOrderId}`,
          },
          body: "{}",
        },
      );
    } catch (captureError) {
      const issue = captureError?.paypal?.details?.[0]?.issue;

      if (issue !== "ORDER_ALREADY_CAPTURED") {
        throw captureError;
      }

      capturedOrder = await callPayPalApi(
        `/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}`,
        { method: "GET" },
      );
    }

    const capture =
      capturedOrder?.purchase_units?.[0]?.payments?.captures?.[0] || null;

    if (!capture?.id || capture.status !== "COMPLETED") {
      throw new Error("PayPal payment was not completed.");
    }

    const capturedAmount = Number(capture.amount?.value || 0);
    if (Math.abs(capturedAmount - calculatedTotal) > 0.001) {
      throw new Error(
        `PayPal amount mismatch. Expected ${calculatedTotal.toFixed(2)} but received ${capturedAmount.toFixed(2)}.`,
      );
    }

    const providerPaymentId = `paypal:${capture.id}`;
    const estimatedWhccCosts = await estimateWhccCostsFromItems(items);
    const estimatedProfitMetrics = calculateProfitMetrics(
      calculatedTotal,
      estimatedWhccCosts.total,
    );

    await db.execute(
      `
        INSERT INTO orders (
          square_payment_id,
          square_order_id,
          receipt_url,
          customer_name,
          customer_email,
          customer_phone,
          customer_address,
          customer_city,
          customer_state,
          customer_zip,
          order_total,
          currency,
          items_json,
          status,
          estimated_whcc_subtotal,
          estimated_whcc_tax,
          estimated_whcc_total,
          estimated_whcc_product_cost,
          estimated_whcc_shipping_cost,
          estimated_profit,
          estimated_profit_margin
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        providerPaymentId,
        providerOrderId,
        null,
        customer.name || null,
        customer.email || null,
        customer.phone || null,
        customer.address || null,
        customer.city || null,
        customer.state || null,
        customer.zip || null,
        calculatedTotal,
        "USD",
        JSON.stringify(items),
        "paid",
        estimatedWhccCosts.subtotal,
        estimatedWhccCosts.tax,
        estimatedWhccCosts.total,
        estimatedWhccCosts.productCost,
        estimatedWhccCosts.shippingCost,
        estimatedProfitMetrics.profit,
        estimatedProfitMetrics.margin,
      ],
    );

    let fulfillmentWarning = null;

    try {
      const whccResult = await fulfillOrderWithWhccOrManual({
        orderId: providerPaymentId,
        customer: {
          name: customer.name,
          address: customer.address,
          city: customer.city,
          state: customer.state,
          zip: customer.zip,
          country: "US",
          phone: customer.phone,
        },
        items: items.map((item) => ({
          material: String(item.material || "").trim().toLowerCase(),
          size: String(item.size || "").trim(),
          finish: String(item.finish || "").trim().toLowerCase(),
          imageKey: item.imageKey,
          title: item.title,
          quantity: item.quantity || 1,
        })),
      });

      const whccCosts = extractWhccCosts(whccResult);
      const actualProfitMetrics = calculateProfitMetrics(
        calculatedTotal,
        whccCosts.total,
      );

      await db.execute(
        `
          UPDATE orders
          SET whcc_status = ?,
              whcc_confirmation_id = ?,
              whcc_error = NULL,
              whcc_subtotal = ?,
              whcc_tax = ?,
              whcc_total = ?,
              whcc_product_cost = ?,
              whcc_shipping_cost = ?,
              actual_profit = ?,
              actual_profit_margin = ?,
              whcc_cost_json = ?
          WHERE square_payment_id = ?
        `,
        [
          JSON.stringify(whccResult),
          whccResult?.confirmationId || null,
          whccCosts.subtotal,
          whccCosts.tax,
          whccCosts.total,
          whccCosts.productCost,
          whccCosts.shippingCost,
          actualProfitMetrics.profit,
          actualProfitMetrics.margin,
          JSON.stringify(whccCosts.raw),
          providerPaymentId,
        ],
      );

      if (items.some(isCalendarItem)) {
        await db.execute(
          `
            UPDATE orders
            SET needs_manual_review = 1,
                manual_review_reason = ?
            WHERE square_payment_id = ?
          `,
          ["Calendar order requires manual fulfillment", providerPaymentId],
        );
      }
    } catch (fulfillmentError) {
      fulfillmentWarning = fulfillmentError.message || "Fulfillment failed";
      console.error("PayPal order fulfillment warning:", fulfillmentError);

      await db.execute(
        `
          UPDATE orders
          SET needs_manual_review = 1,
              manual_review_reason = ?,
              whcc_error = ?
          WHERE square_payment_id = ?
        `,
        [
          `PayPal payment captured; manual fulfillment required: ${fulfillmentWarning}`,
          fulfillmentWarning,
          providerPaymentId,
        ],
      );
    }

    try {
      await sendOrderNotification({
        paymentId: capture.id,
        receiptUrl: null,
        amount: Math.round(calculatedTotal * 100),
        customer,
        selections: items,
        notes: fulfillmentWarning
          ? `PayPal order captured. Manual review required: ${fulfillmentWarning}`
          : "Paid with PayPal",
      });
    } catch (emailError) {
      console.error("PayPal order email failed:", emailError);
    }

    return res.json({
      success: true,
      orderId: paypalOrderId,
      captureId: capture.id,
      status: capture.status,
      fulfillmentWarning,
      redirectUrl: `/success.html?paymentId=${encodeURIComponent(capture.id)}`,
    });
  } catch (error) {
    console.error("PayPal capture error:", error);
    return res.status(error.status || 500).json({
      error: error.message || "Unable to capture PayPal payment",
    });
  }
});

/* =============================
   SQUARE PAYMENT
============================= */

app.post("/api/payments/square", async (req, res) => {
  try {
    const { sourceId, orderDetails = {}, checkoutAttemptId } = req.body;

    logOrder("====================================");
    logOrder("[ORDER START]");

    const orderId = `order-${Date.now()}`;

    logOrder("internalOrderId:", orderId);
    logOrder("checkoutAttemptId:", checkoutAttemptId);
    logOrder("submitEnabled:", process.env.WHCC_ENABLE_SUBMIT);
    logOrder("items:", JSON.stringify(orderDetails.items || [], null, 2));

    if (!checkoutAttemptId) {
      return res.status(400).json({ error: "Missing checkoutAttemptId" });
    }

    if (!sourceId) {
      return res.status(400).json({ error: "Missing sourceId" });
    }

    if (!orderDetails || !orderDetails.items?.length) {
      return res.status(400).json({ error: "Invalid order" });
    }

    if (!process.env.SQUARE_ACCESS_TOKEN) {
      return res.status(500).json({
        error: "Missing SQUARE_ACCESS_TOKEN in environment",
      });
    }

    const calculatedTotal = await calculateOrderTotal(orderDetails.items);
    const amountInCents = BigInt(Math.round(calculatedTotal * 100));

    logOrder("Square payment received", {
      hasItems: !!orderDetails?.items?.length,
      amount: calculatedTotal,
    });

    // 🔒 PRE-FLIGHT S3 VALIDATION (PREVENT REFUNDS)
    for (const item of orderDetails.items) {
      if (isCalendarItem(item)) {
        logOrder("[S3 SKIPPED] Calendar item uses manual fulfillment");
        continue;
      }

      const exists = await verifyS3ObjectExists(
        process.env.S3_BUCKET_NAME,
        item.imageKey,
      );

      if (!exists) {
        console.error("❌ Missing S3 object:", item.imageKey);

        return res.status(400).json({
          error: `Image not found: ${item.imageKey}`,
        });
      }

      logOrder("✅ S3 verified:", item.imageKey);
    }

    const paymentResponse = await squareClient.payments.create({
      sourceId,
      idempotencyKey: checkoutAttemptId,
      amountMoney: {
        amount: amountInCents,
        currency: "USD",
      },
      locationId: process.env.SQUARE_LOCATION_ID,
      autocomplete: false,
    });

    const payment =
      paymentResponse.result?.payment || paymentResponse.payment || null;

    if (!payment?.id) {
      throw new Error(
        "Square payment create response did not include a payment id",
      );
    }

    async function completeSquarePayment(paymentId) {
      return await squareClient.payments.complete({
        paymentId,
      });
    }

    async function cancelSquarePayment(paymentId) {
      return await squareClient.payments.cancel({
        paymentId,
      });
    }

    logOrder(
      "items received by server =",
      JSON.stringify(orderDetails.items || [], null, 2),
    );

    const customer = orderDetails.customer || {};

    const squarePaymentId = payment?.id || null;
    const squareOrderId = payment?.orderId || null;
    const receiptUrl = payment?.receiptUrl || null;

    if (!squarePaymentId) {
      throw new Error("Missing squarePaymentId before capture/cancel");
    }

    const customerName = customer.name || null;
    const customerEmail = customer.email || null;
    const customerPhone = customer.phone || null;
    const customerAddress = customer.address || null;
    const customerCity = customer.city || null;
    const customerState = customer.state || null;
    const customerZip = customer.zip || null;

    const orderTotal = calculatedTotal;
    const currency = "USD";
    const status = "pending";

    const items = orderDetails.items || orderDetails.selections || [];
    const estimatedWhccCosts = await estimateWhccCostsFromItems(items);

    const estimatedProfitMetrics = calculateProfitMetrics(
      orderTotal,
      estimatedWhccCosts.total,
    );

    logOrder("[PAYMENT CREATED]", {
      paymentId: payment?.id || null,
      orderId: payment?.orderId || null,
      status: payment?.status || null,
    });

    logOrder("[ORDER SUMMARY]", {
      paymentId: squarePaymentId,
      orderTotal,
      itemCount: items.length,
    });

    try {
      await db.execute(
        `
INSERT INTO orders (
  square_payment_id,
  square_order_id,
  receipt_url,
  customer_name,
  customer_email,
  customer_phone,
  customer_address,
  customer_city,
  customer_state,
  customer_zip,
  order_total,
  currency,
  items_json,
  status,
  estimated_whcc_subtotal,
  estimated_whcc_tax,
  estimated_whcc_total,
  estimated_whcc_product_cost,
  estimated_whcc_shipping_cost,
  estimated_profit,
  estimated_profit_margin
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
        [
          squarePaymentId,
          squareOrderId,
          receiptUrl,
          customerName,
          customerEmail,
          customerPhone,
          customerAddress,
          customerCity,
          customerState,
          customerZip,
          orderTotal,
          currency,
          JSON.stringify(items),
          status,
          estimatedWhccCosts.subtotal,
          estimatedWhccCosts.tax,
          estimatedWhccCosts.total,
          estimatedWhccCosts.productCost,
          estimatedWhccCosts.shippingCost,
          estimatedProfitMetrics.profit,
          estimatedProfitMetrics.margin,
        ],
      );

      logOrder("✅ Order saved to database");
    } catch (dbError) {
      console.error("❌ Failed to save order to DB:", dbError);
      return res.status(500).json({
        error: "Failed to save order",
        details: dbError.message,
      });
    }

    let whccResult = null;
    let whccErrorMessage = null;
    let paymentCaptured = false;
    let whccSucceeded = false; // ✅ ADD THIS
    let finalReceiptUrl = receiptUrl || null;

    try {
      logWhcc("[WHCC] starting fulfillment");
      logWhcc("[WHCC IMPORT] calling fulfillOrderWithWhcc");

      whccResult = await fulfillOrderWithWhccOrManual({
        orderId: squarePaymentId,
        customer: {
          name: customerName,
          address: customerAddress,
          city: customerCity,
          state: customerState,
          zip: customerZip,
          country: "US",
          phone: customerPhone,
        },
        items: items.map((item) => ({
          material: String(item.material || "")
            .trim()
            .toLowerCase(),
          size: String(item.size || "").trim(),
          finish: String(item.finish || "")
            .trim()
            .toLowerCase(),
          imageKey: item.imageKey,
          title: item.title,
          quantity: item.quantity || 1,
        })),
      });

      logWhcc("[WHCC SUCCESS]");
      whccSucceeded = true; // ✅ ADD THIS HERE
      debugLog("[WHCC RESULT]:", JSON.stringify(whccResult, null, 2));
      logWhcc("[WHCC CONFIRMATION ID]:", whccResult?.confirmationId);

      if (squarePaymentId) {
        await completeSquarePayment(squarePaymentId);
        paymentCaptured = true;
        logOrder("[SQUARE CAPTURED]:", squarePaymentId);

        let completedPayment = null;
        let attempts = 0;

        while (attempts < 5) {
          completedPayment = await getSquarePayment(squarePaymentId);

          const url =
            completedPayment?.receiptUrl || completedPayment?.receipt_url;

          if (url) {
            finalReceiptUrl = url;
            break;
          }

          await new Promise((r) => setTimeout(r, 500)); // wait 500ms
          attempts++;
        }

        logOrder("[SQUARE RECEIPT URL]:", finalReceiptUrl || "not available");
      }

      const whccCosts = extractWhccCosts(whccResult);
      logWhcc("[WHCC COSTS PARSED]:", JSON.stringify(whccCosts, null, 2));
      debugLog(
        "[WHCC IMPORT RESPONSE ORDERS]:",
        JSON.stringify(whccResult?.importResponse?.Orders || null, null, 2),
      );
      const actualProfitMetrics = calculateProfitMetrics(
        orderTotal,
        whccCosts.total,
      );

      logWhcc("[ACTUAL PROFIT]", actualProfitMetrics);

      await db.execute(
        `
UPDATE orders
SET
  status = ?,
  receipt_url = ?,
  whcc_status = ?,
  whcc_confirmation_id = ?,
  whcc_error = ?,
  whcc_subtotal = ?,
  whcc_tax = ?,
  whcc_total = ?,
  whcc_product_cost = ?,
  whcc_shipping_cost = ?,
  actual_profit = ?,
  actual_profit_margin = ?,
  whcc_cost_json = ?
WHERE square_payment_id = ?
`,
        [
          "paid",
          finalReceiptUrl,
          JSON.stringify(whccResult),
          whccResult?.confirmationId || null,
          null,
          whccCosts.subtotal,
          whccCosts.tax,
          whccCosts.total,
          whccCosts.productCost,
          whccCosts.shippingCost,
          actualProfitMetrics.profit,
          actualProfitMetrics.margin,
          JSON.stringify(whccCosts.raw),
          squarePaymentId,
        ],
      );

      // Calendar inventory is fulfilled outside WHCC, so surface the order
      // prominently in the admin dashboard for packing and shipment.
      if (items.some(isCalendarItem)) {
        await db.execute(
          `
            UPDATE orders
            SET needs_manual_review = 1,
                manual_review_reason = ?
            WHERE square_payment_id = ?
          `,
          ["Calendar order requires manual fulfillment", squarePaymentId],
        );
        logOrder("[MANUAL FULFILLMENT] Calendar order flagged for review");
      }
    } catch (whccError) {
      whccErrorMessage = whccError.message || "Unknown WHCC error";
      console.error("[ORDER FLOW FAILED]:", {
        error: whccErrorMessage,
        paymentId: squarePaymentId,
        items,
      });

      if (squarePaymentId && !whccSucceeded) {
        try {
          await cancelSquarePayment(squarePaymentId);
          console.log("[SQUARE CANCELED]:", squarePaymentId);
        } catch (cancelError) {
          console.error("[SQUARE CANCEL FAILED]:", cancelError.message);
        }
      }

      await db.execute(
        `
UPDATE orders
SET
  status = ?,
  whcc_status = ?,
  whcc_confirmation_id = ?,
  whcc_error = ?
WHERE square_payment_id = ?
`,
        [
          whccSucceeded ? "paid" : "cancelled",
          whccSucceeded ? JSON.stringify(whccResult) : null,
          whccSucceeded ? whccResult?.confirmationId || null : null,
          whccErrorMessage,
          squarePaymentId,
        ],
      );

      if (whccSucceeded) {
        await db.execute(
          `
    UPDATE orders
    SET
      needs_manual_review = 1,
      manual_review_reason = ?
    WHERE square_payment_id = ?
    `,
          ["WHCC succeeded but a later step failed", squarePaymentId],
        );
      }

      return res.status(500).json({
        error: `Order could not be completed: ${whccErrorMessage}`,
      });
    }

    logEmail("[EMAIL] attempting to send order emails");

    try {
      await sendOrderNotification({
        paymentId: payment?.id || null,
        receiptUrl: finalReceiptUrl,
        amount: Number(amountInCents),
        customer: orderDetails.customer || {},
        selections: orderDetails.items || orderDetails.selections || [],
        notes: orderDetails.notes || "",
      });

      logEmail("[EMAIL] SUCCESS");
    } catch (emailError) {
      console.error("[EMAIL FAILED]:", {
        error: emailError.message,
        paymentId: payment?.id,
      });
    }

    logOrder("[ORDER END]");
    logOrder("====================================");

    return res.status(200).json({
      success: true,
      paymentId: payment?.id || null,
      status: "COMPLETED",
      receiptUrl: finalReceiptUrl,
      redirectUrl: `/success.html?paymentId=${encodeURIComponent(payment?.id || "")}`,
    });
  } catch (error) {
    console.error("Square payment error:", error);

    if (error instanceof SquareError) {
      const detail =
        error.errors?.[0]?.detail ||
        error.errors?.[0]?.code ||
        "Square payment failed";

      return res.status(500).json({ error: detail });
    }

    return res.status(500).json({
      error: error.message || "Payment failed",
    });
  }
});

/* =============================
   ROUTES
============================= */
/* =============================
   WHCC WEBHOOK REGISTRATION
   Completed on 2026-05-08.
   Webhook verified by WHCC.
   Do not re-register unless changing webhook URL.
============================= */

app.get("/api/whcc/test-auth", async (req, res) => {
  try {
    const tokenData = await getWhccAccessToken();

    res.json({
      success: true,
      clientId: tokenData.ClientId || null,
      expiresAt: tokenData.ExpirationDate || null,
      hasToken: Boolean(tokenData.Token),
    });
  } catch (err) {
    console.error("WHCC auth test failed:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/whcc/catalog", async (req, res) => {
  try {
    const tokenData = await getWhccAccessToken();

    const response = await fetch(`${process.env.WHCC_BASE_URL}/api/catalog`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${tokenData.Token}`,
      },
    });

    const text = await response.text();
    let data = null;

    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text };
    }

    if (!response.ok) {
      return res.status(response.status).json({
        error: "WHCC catalog request failed",
        details: data,
      });
    }

    res.json(data);
  } catch (err) {
    console.error("WHCC catalog test failed:", err);
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/contact-submissions/:id/replied", async (req, res) => {
  const adminPassword = req.headers.authorization?.split(" ")[1];

  if (adminPassword !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { id } = req.params;

  try {
    await db.execute(
      "UPDATE contact_submissions SET replied = 1 WHERE id = ?",
      [id],
    );

    res.json({ success: true });
  } catch (err) {
    console.error("Failed to mark contact submission as replied:", err);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/api/contact-submissions", async (req, res) => {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.replace("Bearer ", "").trim();

  if (!process.env.ADMIN_PASSWORD || token !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const [rows] = await db.query(`
      SELECT id, name, email, subject, message, created_at, replied
FROM contact_submissions
ORDER BY created_at DESC
    `);

    res.json(rows);
  } catch (err) {
    console.error("Error loading contact submissions:", err);
    res.status(500).json({ error: "Failed to load contact submissions" });
  }
});

app.put("/api/orders/:id/status", async (req, res) => {
  console.log("PUT /api/orders/:id/status hit");
  console.log("params:", req.params);
  console.log("body:", req.body);
  const authHeader = req.headers.authorization || "";
  const token = authHeader.replace("Bearer ", "").trim();

  if (!process.env.ADMIN_PASSWORD || token !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { id } = req.params;
  const { status } = req.body;

  const allowedStatuses = [
    "pending",
    "paid",
    "processing",
    "shipped",
    "completed",
    "cancelled",
  ];

  if (!allowedStatuses.includes(status)) {
    return res.status(400).json({ error: "Invalid status" });
  }

  try {
    const [result] = await db.query(
      "UPDATE orders SET status = ? WHERE id = ?",
      [status, id],
    );

    if (!result.affectedRows) {
      return res.status(404).json({ error: "Order not found" });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("Error updating order status:", err);
    res.status(500).json({ error: "Failed to update order status" });
  }
});

app.get("/api/orders", async (req, res) => {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.replace("Bearer ", "").trim();

  if (!process.env.ADMIN_PASSWORD || token !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const [rows] = await db.query(`
  SELECT
  id,
  square_payment_id,
  square_order_id,
  receipt_url,
  customer_name,
  customer_email,
  customer_phone,
  customer_address,
  customer_city,
  customer_state,
  customer_zip,
  order_total,
  items_json,
  status,
  created_at,
  whcc_subtotal,
  whcc_tax,
  whcc_total,
  whcc_product_cost,
  whcc_shipping_cost,
  whcc_confirmation_id,
  estimated_whcc_subtotal,
  estimated_whcc_tax,
  estimated_whcc_total,
  estimated_whcc_product_cost,
  estimated_whcc_shipping_cost,
  tracking_number,
tracking_carrier,
tracking_url,
shipped_at,
shipped_email_sent,
  estimated_profit,
  estimated_profit_margin,
  actual_profit,
  actual_profit_margin
FROM orders
ORDER BY created_at DESC
`);

    res.json(rows);
  } catch (err) {
    console.error("Error loading orders:", err);
    res.status(500).json({ error: "Failed to load orders" });
  }
});

app.get("/api/admin/schema-check", checkAdmin, async (req, res) => {
  try {
    const [rows] = await db.execute(`
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'orders'
    `);

    const actualColumns = new Set(rows.map((r) => r.COLUMN_NAME));

    const requiredColumns = [
      "square_payment_id",
      "square_order_id",
      "customer_name",
      "customer_email",
      "customer_phone",
      "customer_address",
      "customer_city",
      "customer_state",
      "customer_zip",
      "order_total",
      "currency",
      "items_json",
      "status",
      "estimated_whcc_subtotal",
      "estimated_whcc_tax",
      "estimated_whcc_total",
      "estimated_whcc_product_cost",
      "estimated_whcc_shipping_cost",
      "estimated_profit",
      "estimated_profit_margin",
      "whcc_status",
      "whcc_confirmation_id",
      "whcc_error",
      "whcc_subtotal",
      "whcc_tax",
      "whcc_total",
      "whcc_product_cost",
      "whcc_shipping_cost",
      "actual_profit",
      "actual_profit_margin",
      "whcc_cost_json",
    ];

    const missing = requiredColumns.filter((col) => !actualColumns.has(col));

    return res.json({
      ok: missing.length === 0,
      missing,
    });
  } catch (err) {
    console.error("Schema check failed:", err);
    return res.status(500).json({ error: "Schema check failed" });
  }
});

app.post(
  "/api/restoration-quote",
  (req, res, next) => {
    restorationUpload.single("image")(req, res, (error) => {
      if (error) {
        if (
          error instanceof multer.MulterError &&
          error.code === "LIMIT_FILE_SIZE"
        ) {
          return res.status(400).json({
            error:
              "The uploaded image is larger than 50 MB. Please choose a smaller TIFF, PNG, or high-quality JPEG.",
          });
        }

        if (error.message === "INVALID_RESTORATION_FILE_TYPE") {
          return res.status(400).json({
            error: "Please upload a TIFF, PNG, or high-quality JPEG image.",
          });
        }

        return res.status(400).json({
          error:
            "The photograph could not be uploaded. Please check the file and try again.",
        });
      }

      next();
    });
  },

  async (req, res) => {
    try {
      const name = String(req.body.name || "").trim();
      const email = String(req.body.email || "").trim();
      const phone = String(req.body.phone || "").trim();
      const photoAge = String(req.body.photoAge || "").trim();
      const description = String(req.body.description || "").trim();

      const rightsConfirmed =
        String(req.body.rightsConfirmed || "") === "on" ||
        String(req.body.rightsConfirmed || "") === "true";

      const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

      if (!name) {
        return res.status(400).json({
          error: "Name is required.",
        });
      }

      if (!email || !emailPattern.test(email)) {
        return res.status(400).json({
          error: "A valid email address is required.",
        });
      }

      if (!phone) {
        return res.status(400).json({
          error: "Phone number is required.",
        });
      }

      if (!req.file) {
        return res.status(400).json({
          error: "A TIFF, PNG, or high-quality JPEG photograph is required.",
        });
      }

      if (!description || description.length < 20) {
        return res.status(400).json({
          error:
            "Please describe the damage and any specific restoration changes you would like.",
        });
      }

      if (!rightsConfirmed) {
        return res.status(400).json({
          error:
            "You must confirm that you own the photograph or have permission to submit it.",
        });
      }

      /*
       * Copyright/trademark inspection will be added here.
       *
       * Important: file name scanning alone is not enough.
       * The image contents must be examined by OCR or a
       * dedicated image-analysis service.
       */

      await sendRestorationQuoteEmail({
        name,
        email,
        phone,
        photoAge,
        description,
        file: req.file,
      });

      return res.status(200).json({
        success: true,
        message: "Restoration quote request received.",
        received: {
          name,
          email,
          phone,
          photoAge,
          filename: req.file.originalname,
          fileSize: req.file.size,
        },
      });
    } catch (error) {
      console.error("Restoration quote error:", error);

      return res.status(500).json({
        error: "The quote request could not be submitted.",
      });
    }
  },
);

/* =============================
   API 404
============================= */

app.post("/api/pricing", checkAdmin, async (req, res) => {
  try {
    const { material, size, finish, price } = req.body;

    if (
      !material ||
      !size ||
      !finish ||
      price === undefined ||
      price === null ||
      Number.isNaN(Number(price))
    ) {
      return res
        .status(400)
        .json({ error: "material, size, finish, and price are required" });
    }

    await db.execute(
      `
      INSERT INTO pricing (
        material,
        size,
        finish,
        price,
        active
      ) VALUES (?, ?, ?, ?, 1)
    `,
      [material, size, finish, Number(price)],
    );

    res.json({ success: true });
  } catch (err) {
    console.error("Failed to add pricing:", err);
    res.status(500).json({ error: "Failed to add pricing." });
  }
});

app.get("/api/whcc/test", async (req, res) => {
  try {
    const result = await fulfillOrderWithWhcc({
      orderId: "TEST-123",
      customer: {
        name: "Test User",
        address: "123 Test St",
        city: "Fort Myers",
        state: "FL",
        zip: "33901",
        country: "US",
        phone: "5555555555",
      },
      items: [
        {
          material: "metal",
          size: "5x7",
          finish: "matte",
          imageKey: "7parakeets.jpg",
          title: "Test Photo",
        },
      ],
    });

    res.json(result);
  } catch (err) {
    console.error("WHCC test failed:", err);
    res.status(500).json({ error: err.message });
  }
});

/* =============================
   UPDATE PRICING
============================= */

app.put("/api/pricing/:id", checkAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { price } = req.body;

    if (!id || price == null) {
      return res.status(400).json({
        error: "ID and price are required",
      });
    }

    await db.execute(
      `
      UPDATE pricing
      SET price = ?
      WHERE id = ?
      `,
      [price, id],
    );

    return res.json({ success: true });
  } catch (error) {
    console.error("Failed to update pricing:", error);
    return res.status(500).json({
      error: "Failed to update pricing",
    });
  }
});

app.delete("/api/pricing/:id", checkAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);

    if (!id) {
      return res.status(400).json({ error: "Valid pricing ID is required" });
    }

    const [result] = await db.execute("DELETE FROM pricing WHERE id = ?", [id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Pricing row not found" });
    }

    return res.json({ success: true });
  } catch (error) {
    console.error("Failed to delete pricing row:", error);
    return res.status(500).json({ error: "Failed to delete pricing row" });
  }
});

app.use("/api", (req, res) => {
  res.status(404).json({ error: "API route not found" });
});

/* =============================
   SPA FALLBACK
============================= */

app.get("*", (req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

/* =============================
   ERROR HANDLER
============================= */

app.use((err, req, res, next) => {
  console.error("Unhandled server error:", err);

  if (err instanceof SyntaxError && "body" in err) {
    return res.status(400).json({ error: "Invalid JSON request body" });
  }

  return res.status(500).json({ error: "Internal server error" });
});

/* =============================
   START SERVER
============================= */

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});

app.post("/api/orders/:id/send-shipping-email", async (req, res) => {
  try {
    const orderId = req.params.id;

    const [orders] = await db.query(
      `SELECT * FROM orders WHERE id = ? LIMIT 1`,
      [orderId],
    );

    if (!orders.length) {
      return res.status(404).json({ error: "Order not found" });
    }

    const order = orders[0];

    if (!order.tracking_number) {
      return res.status(400).json({ error: "Tracking number required" });
    }

    await sendShipmentEmail({
      order,
      trackingNumber: order.tracking_number,
      trackingUrl: order.tracking_url,
    });

    await db.query(`UPDATE orders SET shipped_email_sent = 1 WHERE id = ?`, [
      orderId,
    ]);

    return res.json({ success: true });
  } catch (err) {
    console.error("Manual shipping email error:", err);
    return res.status(500).json({ error: "Failed to send email" });
  }
});
