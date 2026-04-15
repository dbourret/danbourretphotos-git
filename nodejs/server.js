require("dotenv").config();

const { fulfillOrderWithWhcc, getWhccAccessToken } = require("./whcc");

console.log("DB_HOST =", process.env.DB_HOST);
console.log("DB_USER =", process.env.DB_USER);
console.log("DB_PASS exists =", !!process.env.DB_PASS);
console.log("DB_NAME =", process.env.DB_NAME);

console.log("SMTP_HOST =", process.env.SMTP_HOST);
console.log("SMTP_PORT =", process.env.SMTP_PORT);
console.log("SMTP_USER =", process.env.SMTP_USER);
console.log("SMTP_PASS exists =", !!process.env.SMTP_PASS);

const MATERIAL_DB_MAP = {
  poster: "Poster",
  metal: "Metal",
  wood: "Wood",
  canvas: "Canvas",
};

function normalizeMaterialForDb(material = "") {
  return MATERIAL_DB_MAP[String(material).trim().toLowerCase()] || material;
}

function normalizeFinishForDb(finish = "") {
  return String(finish).trim().toLowerCase();
}
const express = require("express");
const path = require("path");
const crypto = require("crypto");
const nodemailer = require("nodemailer");
const mysql = require("mysql2/promise");
const rateLimit = require("express-rate-limit");
const { SquareClient, SquareEnvironment, SquareError } = require("square");

const app = express();
app.use(express.json());
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

/* =============================
   REQUEST LOGGING
============================= */

app.use((req, res, next) => {
  console.log(`REQUEST: ${req.url}`);
  next();
});

/* =============================
   BODY PARSING
============================= */

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

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
      "script-src 'self' 'unsafe-inline' https://sandbox.web.squarecdn.com https://web.squarecdn.com",
      "style-src 'self' 'unsafe-inline' https://sandbox.web.squarecdn.com https://web.squarecdn.com",
      "style-src-elem 'self' 'unsafe-inline' https://sandbox.web.squarecdn.com https://web.squarecdn.com",
      "img-src 'self' data: https:",
      "connect-src 'self' https://sandbox.web.squarecdn.com https://web.squarecdn.com https://connect.squareupsandbox.com https://connect.squareup.com https://pci-connect.squareupsandbox.com https://pci-connect.squareup.com https://o160250.ingest.sentry.io",
      "frame-src 'self' https://sandbox.web.squarecdn.com https://web.squarecdn.com",
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

app.get("/api/pricing", async (req, res) => {
  try {
    const [rows] = await db.execute(
      `
      SELECT
        id,
        material,
        size,
        finish,
        price,
        active
      FROM pricing
      WHERE active = 1
      ORDER BY material, size, finish
      `,
    );

    return res.json(rows);
  } catch (error) {
    console.error("Failed to fetch pricing:", error);

    return res.status(500).json({
      error: "Failed to fetch pricing",
    });
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
      WHERE material = ? AND size = ? AND finish = ? AND active = 1
      LIMIT 1
      `,
      [material, size, finish],
    );

    if (!rows.length) {
      throw new Error(`Invalid price for ${material} ${size} ${finish}`);
    }

    let price = Number(rows[0].price);

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
      console.log("CONTACT DB PAYLOAD:", {
        name,
        email,
        subject,
        message,
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

      return `
        <div style="padding:18px;border:1px solid #eadfca;border-radius:16px;background:#ffffff;margin-bottom:18px;">
          <div style="font-size:16px;line-height:1.4;font-weight:700;color:#111827;margin:0 0 14px 0;">
            ${index + 1}. ${title}
          </div>

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
            <div style="font-size:14px;line-height:1.7;color:#374151;">
              ${
                receiptUrl
                  ? `<a href="${escapeHtml(receiptUrl)}" target="_blank" rel="noopener noreferrer" style="color:#9f7a2f;text-decoration:none;font-weight:700;">Open Square receipt</a>`
                  : "Receipt URL not available"
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
  console.log("SMTP host:", process.env.SMTP_HOST);
  console.log("SMTP port:", process.env.SMTP_PORT);
  console.log("SMTP user:", process.env.SMTP_USER);
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

    console.log("Customer confirmation email sent to:", customer.email);
  }

  console.log("Email send result:", info);
  console.log("Sent to:", process.env.ORDER_NOTIFY_EMAIL);
  console.log("Sent from:", process.env.ORDER_FROM_EMAIL);
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

app.get("/api/config/square", (req, res) => {
  const appId = process.env.SQUARE_APP_ID;
  const locationId = process.env.SQUARE_LOCATION_ID;
  const environment = String(
    process.env.SQUARE_ENVIRONMENT || "sandbox",
  ).toLowerCase();

  if (!appId || !locationId) {
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
   SQUARE PAYMENT
============================= */

app.post("/api/payments/square", async (req, res) => {
  try {
    const { sourceId, orderDetails = {} } = req.body;

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

    console.log("Square payment req.body:", JSON.stringify(req.body, null, 2));
    console.log("orderDetails:", JSON.stringify(orderDetails, null, 2));

    const calculatedTotal = await calculateOrderTotal(orderDetails.items);
    const amountInCents = BigInt(Math.round(calculatedTotal * 100));

    const paymentResponse = await squareClient.payments.create({
      sourceId,
      idempotencyKey: crypto.randomUUID(),
      amountMoney: {
        amount: amountInCents,
        currency: "USD",
      },
      locationId: process.env.SQUARE_LOCATION_ID,
    });

    const payment = paymentResponse.payment;

    console.log(
      "items received by server =",
      JSON.stringify(orderDetails.items || [], null, 2),
    );

    try {
      const customer = orderDetails.customer || {};

      const squarePaymentId = payment?.id || null;
      const squareOrderId = payment?.orderId || null;

      const customerName = customer.name || null;
      const customerEmail = customer.email || null;
      const customerPhone = customer.phone || null;
      const customerAddress = customer.address || null;
      const customerCity = customer.city || null;
      const customerState = customer.state || null;
      const customerZip = customer.zip || null;

      const orderTotal = calculatedTotal;
      const currency = "USD";
      const status = "paid";

      const items = orderDetails.items || orderDetails.selections || [];

      console.log("ORDER DB PAYLOAD:", {
        squarePaymentId,
        squareOrderId,
        customerName,
        customerEmail,
        customerPhone,
        customerAddress,
        customerCity,
        customerState,
        customerZip,
        orderTotal,
        currency,
        items,
      });

      await db.execute(
        `
  INSERT INTO orders (
    square_payment_id,
    square_order_id,
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
    status
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
        [
          squarePaymentId,
          squareOrderId,
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
        ],
      );

      console.log("✅ Order saved to database");

      let whccResult = null;
      let whccErrorMessage = null;

      try {
        console.log("🚀 Sending paid order to WHCC...");

        whccResult = await fulfillOrderWithWhcc({
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

        console.log("✅ WHCC fulfillment success:", whccResult);
        // ✅ ADD THIS RIGHT HERE
        await db.execute(
          `
  UPDATE orders
  SET 
    whcc_status = ?,
    whcc_confirmation_id = ?,
    whcc_error = ?
  WHERE square_payment_id = ?
  `,
          [
            JSON.stringify(whccResult),
            whccResult?.confirmationId || null,
            null,
            squarePaymentId,
          ],
        );
      } catch (whccError) {
        whccErrorMessage = whccError.message || "Unknown WHCC error";
        console.error("❌ WHCC fulfillment failed:", whccErrorMessage);
        // ✅ ADD THIS RIGHT HERE
        await db.execute(
          `
    UPDATE orders
    SET 
      whcc_status = ?,
      whcc_confirmation_id = ?,
      whcc_error = ?
    WHERE square_payment_id = ?
    `,
          [null, null, whccErrorMessage, squarePaymentId],
        );
      }
    } catch (dbError) {
      console.error("❌ Failed to save order to DB:", dbError);
      return res.status(500).json({
        error: "Failed to save order",
        details: dbError.message,
      });
    }

    await sendOrderNotification({
      paymentId: payment?.id || null,
      receiptUrl: payment?.receiptUrl || null,
      amount: Number(amountInCents),
      customer: orderDetails.customer || {},
      selections: orderDetails.items || orderDetails.selections || [],
      notes: orderDetails.notes || "",
    });

    return res.status(200).json({
      success: true,
      paymentId: payment?.id || null,
      status: payment?.status || null,
      receiptUrl: payment?.receiptUrl || null,
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

app.get("/api/contact-submissions", async (req, res) => {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.replace("Bearer ", "").trim();

  if (!process.env.ADMIN_PASSWORD || token !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const [rows] = await db.query(`
      SELECT
        id,
        name,
        email,
        subject,
        message,
        created_at
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
  created_at
FROM orders
      ORDER BY created_at DESC
    `);

    res.json(rows);
  } catch (err) {
    console.error("Error loading orders:", err);
    res.status(500).json({ error: "Failed to load orders" });
  }
});

/* =============================
   API 404
============================= */

app.post("/api/pricing", checkAdmin, async (req, res) => {
  try {
    const material = String(req.body.material || "").trim();
    const size = String(req.body.size || "").trim();
    const price = Number(req.body.price);

    if (!material || !size || Number.isNaN(price)) {
      return res.status(400).json({
        error: "Material, size, and valid price are required",
      });
    }

    await db.execute(
      `
      INSERT INTO pricing (
        material,
        size,
        price,
        active
      ) VALUES (?, ?, ?, 1)
      `,
      [material, size, price],
    );

    return res.json({ success: true });
  } catch (error) {
    console.error("Failed to add pricing:", error);
    return res.status(500).json({
      error: "Failed to add pricing",
    });
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
