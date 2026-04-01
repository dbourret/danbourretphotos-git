require("dotenv").config();

const express = require("express");
const path = require("path");
const crypto = require("crypto");
const nodemailer = require("nodemailer");
const {
  SquareClient,
  SquareEnvironment,
  SquareError
} = require("square");

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const publicDir = path.join(__dirname, "public");

console.log("__dirname =", __dirname);
console.log("publicDir =", publicDir);

app.disable("x-powered-by");

console.log("SQUARE_ENVIRONMENT =", process.env.SQUARE_ENVIRONMENT);
console.log("SQUARE_APP_ID =", process.env.SQUARE_APP_ID);
console.log("SQUARE_LOCATION_ID =", process.env.SQUARE_LOCATION_ID);
console.log(
  "SQUARE_ACCESS_TOKEN starts with =",
  process.env.SQUARE_ACCESS_TOKEN?.slice(0, 12)
);

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
      "font-src 'self' data: https://sandbox.web.squarecdn.com https://web.squarecdn.com"
    ].join("; ")
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
    time: new Date().toISOString()
  });
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
    pass: process.env.SMTP_PASS
  },
  pool: true,          // ✅ reuse connections
  maxConnections: 1,   // ✅ prevent spam connections
  maxMessages: 50      // optional
});

// run once when server starts
transporter.verify((err, success) => {
  if (err) {
    console.error("SMTP ERROR:", err);
  } else {
    console.log("SMTP server is ready");
  }
});

transporter.verify((error, success) => {
  if (error) {
    console.error("SMTP verify failed:", error);
  } else {
    console.log("SMTP server is ready to send mail");
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
        `   Image: ${image}`
      ].join("\n");
    })
    .join("\n\n");
}

function formatSelectionsForHtml(selections) {
  if (!Array.isArray(selections) || selections.length === 0) {
    return `<div style="padding:16px;border:1px solid #e5e7eb;border-radius:14px;background:#ffffff;">No items provided</div>`;
  }

  return selections
    .map((item, index) => {
      const title = escapeHtml(
  item.title ||
  [item.size, item.material].filter(Boolean).join(" ") ||
  "Untitled Photo"
);
      const size = escapeHtml(item.size || "Not selected");
      const material = escapeHtml(item.material || "Not selected");
      const finish = escapeHtml(item.finish || "Not selected");
      const price =
        item.price != null
          ? escapeHtml(typeof item.price === "number" ? formatMoney(item.price) : item.price)
          : "Not available";
      const image = item.image
        ? `<div style="margin-top:8px;"><a href="${escapeHtml(item.image)}" target="_blank" rel="noopener noreferrer" style="color:#9f7a2f;text-decoration:none;">View selected image</a></div>`
        : "";

      return `
        <div style="padding:18px;border:1px solid #e5e7eb;border-radius:16px;background:#ffffff;margin-bottom:14px;">
          <div style="font-size:16px;font-weight:700;color:#111827;margin-bottom:10px;">
            ${index + 1}. ${title}
          </div>
          <div style="color:#374151;font-size:14px;line-height:1.7;">
            <div><strong>Size:</strong> ${size}</div>
            <div><strong>Material:</strong> ${material}</div>
            <div><strong>Finish:</strong> ${finish}</div>
            <div><strong>Price:</strong> ${price}</div>
            ${image}
          </div>
        </div>
      `;
    })
    .join("");
}

async function sendOrderNotification({
  paymentId,
  receiptUrl,
  amount,
  customer,
  selections,
  notes
}) {
  if (!process.env.ORDER_NOTIFY_EMAIL || !process.env.ORDER_FROM_EMAIL) {
    console.warn("Order email skipped: missing ORDER_NOTIFY_EMAIL or ORDER_FROM_EMAIL");
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
            Dan Bourret Photography
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
  from: `"Dan Bourret Photography" <${process.env.ORDER_FROM_EMAIL}>`,
  to: process.env.ORDER_NOTIFY_EMAIL,
  replyTo:
    customer?.email && customer.email.includes("@")
      ? customer.email
      : process.env.ORDER_FROM_EMAIL,
  subject,
  text: textBody,
  html: htmlBody
});

// Send confirmation email to customer
if (customer?.email && customer.email.includes("@")) {
  const customerSubject = "Your Order Confirmation - Dan Bourret Photography";

  const customerText = `
Thank you for your order!

ORDER SUMMARY
Payment ID: ${paymentId || "Not available"}
Total: ${formatMoney(Number(amount || 0) / 100)}

We have received your order and will begin processing it shortly.

If you have any questions, reply to this email.

Thank you,
Dan Bourret Photography
  `.trim();

  const customerHtml = `
    <div style="font-family:Arial,Helvetica,sans-serif;padding:24px;background:#f5f5f5;">
      <div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:16px;padding:24px;">
        <h2 style="margin-top:0;">Thank you for your order!</h2>

        <p>Your order has been received and is now being processed.</p>

        <div style="margin-top:20px;">
          <strong>Payment ID:</strong> ${escapeHtml(paymentId || "Not available")}<br/>
          <strong>Total:</strong> ${formatMoney(Number(amount || 0) / 100)}
        </div>

        <p style="margin-top:20px;">
          We’ll notify you when your order ships.
        </p>

        <p style="margin-top:20px;">
          If you have questions, just reply to this email.
        </p>

        <p style="margin-top:30px;">
          — Dan Bourret Photography
        </p>
      </div>
    </div>
  `;

  await transporter.sendMail({
    from: `"Dan Bourret Photography" <${process.env.ORDER_FROM_EMAIL}>`,
    to: customer.email,
    subject: customerSubject,
    text: customerText,
    html: customerHtml
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
  process.env.SQUARE_ENVIRONMENT === "production"
    ? SquareEnvironment.Production
    : SquareEnvironment.Sandbox;

const squareClient = new SquareClient({
  token: process.env.SQUARE_ACCESS_TOKEN,
  environment: squareEnvironment
});

/* =============================
   SQUARE CONFIG
============================= */

app.get("/api/config/square", (req, res) => {
  const appId = process.env.SQUARE_APP_ID;
  const locationId = process.env.SQUARE_LOCATION_ID;

  if (!appId || !locationId) {
    return res.status(500).json({
      error: "Missing Square configuration. Check SQUARE_APP_ID and SQUARE_LOCATION_ID."
    });
  }

  return res.json({
    appId,
    locationId,
    environment: process.env.SQUARE_ENVIRONMENT || "sandbox"
  });
});

/* =============================
   SQUARE PAYMENT
============================= */

app.post("/api/payments/square", async (req, res) => {
  try {
    const { sourceId, amount, orderDetails = {} } = req.body;

    if (!sourceId) {
      return res.status(400).json({ error: "Missing sourceId" });
    }

    if (!amount || Number.isNaN(Number(amount)) || Number(amount) <= 0) {
      return res.status(400).json({ error: "Invalid amount" });
    }

    if (!process.env.SQUARE_ACCESS_TOKEN) {
      return res.status(500).json({
        error: "Missing SQUARE_ACCESS_TOKEN in environment"
      });
    }

console.log("Square payment req.body:", JSON.stringify(req.body, null, 2));
console.log("orderDetails:", JSON.stringify(orderDetails, null, 2));

    const amountInCents = BigInt(Math.round(Number(amount)));

    const paymentResponse = await squareClient.payments.create({
      sourceId,
      idempotencyKey: crypto.randomUUID(),
      amountMoney: {
        amount: amountInCents,
        currency: "USD"
      },
      locationId: process.env.SQUARE_LOCATION_ID
    });

    const payment = paymentResponse.payment;
    console.log("items received by server =", JSON.stringify(orderDetails.items || [], null, 2));

    await sendOrderNotification({
      paymentId: payment?.id || null,
      receiptUrl: payment?.receiptUrl || null,
      amount: Number(amount),
      customer: orderDetails.customer || {},
      selections: orderDetails.items || orderDetails.selections || [],
      notes: orderDetails.notes || ""
    });

    return res.status(200).json({
      success: true,
      paymentId: payment?.id || null,
      status: payment?.status || null,
      receiptUrl: payment?.receiptUrl || null,
      redirectUrl: `/success.html?paymentId=${encodeURIComponent(payment?.id || "")}`
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
      error: error.message || "Payment failed"
    });
  }
});

/* =============================
   ROUTES
============================= */

app.get("/", (req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

app.get("/success.html", (req, res) => {
  res.sendFile(path.join(publicDir, "success.html"));
});

/* =============================
   API 404
============================= */

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
