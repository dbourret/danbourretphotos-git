require("dotenv").config();

const express = require("express");
const path = require("path");
const crypto = require("crypto");
const nodemailer = require("nodemailer");

const app = express();
const PORT = process.env.PORT || 3000;
const publicDir = path.join(__dirname, "public");

console.log("__dirname =", __dirname);
console.log("publicDir =", publicDir);

app.use((req, res, next) => {
  const csp = [
    "default-src 'self';",
    "base-uri 'self';",
    "object-src 'none';",
    "script-src 'self' 'unsafe-inline' https://www.paypal.com https://www.sandbox.paypal.com https://www.paypalobjects.com https://web.squarecdn.com https://sandbox.web.squarecdn.com;",
    "style-src 'self' 'unsafe-inline' https://web.squarecdn.com https://sandbox.web.squarecdn.com;",
    "img-src 'self' data: https://www.paypal.com https://www.paypalobjects.com https://www.sandbox.paypal.com https://web.squarecdn.com https://sandbox.web.squarecdn.com;",
    "font-src 'self' data: https://www.paypalobjects.com https://web.squarecdn.com https://sandbox.web.squarecdn.com https:;",
    "connect-src 'self' https://api-m.paypal.com https://api-m.sandbox.paypal.com https://www.paypal.com https://www.sandbox.paypal.com https://connect.squareup.com https://connect.squareupsandbox.com https://pci-connect.squareup.com https://pci-connect.squareupsandbox.com https://web.squarecdn.com https://sandbox.web.squarecdn.com;",
    "frame-src 'self' https://www.paypal.com https://www.sandbox.paypal.com https://web.squarecdn.com https://sandbox.web.squarecdn.com;",
    "child-src 'self' https://www.paypal.com https://www.sandbox.paypal.com https://web.squarecdn.com https://sandbox.web.squarecdn.com;"
  ].join(" ");

  res.setHeader("Content-Security-Policy", csp);
  next();
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(publicDir));

function getPayPalBaseUrl() {
  return process.env.PAYPAL_MODE === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";
}

async function getPayPalAccessToken() {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Missing PayPal credentials");
  }

  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const response = await fetch(`${getPayPalBaseUrl()}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: "grant_type=client_credentials"
  });

  const data = await response.json();

  if (!response.ok || !data.access_token) {
    throw new Error(
      data.error_description || data.error || "Failed to get PayPal access token"
    );
  }

  return data.access_token;
}

function calculateCartTotal(cart) {
  return (cart || []).reduce((sum, item) => {
    const price = Number(item.price || 0);
    const qty = Number(item.qty || 1);
    return sum + price * qty;
  }, 0);
}

function cartToPayPalItems(cart) {
  return (cart || []).map((item) => ({
    name: String(item.photo || "Photo Print").slice(0, 127),
    description: `${item.format || ""} ${item.size || ""}`.trim().slice(0, 127),
    quantity: String(Number(item.qty || 1)),
    unit_amount: {
      currency_code: "USD",
      value: Number(item.price || 0).toFixed(2)
    }
  }));
}

function buildOrderEmail({ paymentId, cart, customer, total }) {
  const itemLines = (cart || [])
    .map((item) => {
      const qty = Number(item.qty || 1);
      const price = Number(item.price || 0);
      const lineTotal = (qty * price).toFixed(2);
      return [
        `${qty} x ${item.photo || "Photo Print"}`,
        `Format: ${item.format || "N/A"}`,
        `Size: ${item.size || "N/A"}`,
        `Unit Price: $${price.toFixed(2)}`,
        `Line Total: $${lineTotal}`
      ].join("\n");
    })
    .join("\n\n");

  return `
New paid order received

Payment ID: ${paymentId || "N/A"}
Total Paid: $${Number(total || 0).toFixed(2)}

Customer
--------
Name: ${customer.name || ""}
Email: ${customer.email || ""}
Phone: ${customer.phone || ""}

Shipping Address
----------------
${customer.address || ""}
${customer.city || ""}, ${customer.state || ""} ${customer.zip || ""}

Items
-----
${itemLines || "No items found"}
  `.trim();
}

async function sendOrderEmail({ paymentId, cart, customer, total }) {
  if (
    !process.env.SMTP_HOST ||
    !process.env.SMTP_PORT ||
    !process.env.SMTP_USER ||
    !process.env.SMTP_PASS ||
    !process.env.ORDER_FROM_EMAIL ||
    !process.env.ORDER_NOTIFY_EMAIL
  ) {
    throw new Error("Missing SMTP or order email environment variables");
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });

  const text = buildOrderEmail({ paymentId, cart, customer, total });

  await transporter.sendMail({
    from: process.env.ORDER_FROM_EMAIL,
    to: process.env.ORDER_NOTIFY_EMAIL,
    subject: `New paid order ${paymentId || ""}`.trim(),
    text,
    replyTo: customer.email || undefined
  });
}

app.get("/api/config/paypal", (req, res) => {
  res.json({
    clientId: process.env.PAYPAL_CLIENT_ID || ""
  });
});

app.get("/api/config/square", (req, res) => {
  res.json({
    appId: process.env.SQUARE_APP_ID || "",
    locationId: process.env.SQUARE_LOCATION_ID || ""
  });
});

app.post("/api/paypal/create-order", async (req, res) => {
  try {
    const cart = req.body.cart || [];
    const total = calculateCartTotal(cart);

    if (!Array.isArray(cart) || cart.length === 0 || total <= 0) {
      return res.status(400).json({ error: "Cart is empty or invalid" });
    }

    const accessToken = await getPayPalAccessToken();

    const orderPayload = {
      intent: "CAPTURE",
      purchase_units: [
        {
          amount: {
            currency_code: "USD",
            value: total.toFixed(2),
            breakdown: {
              item_total: {
                currency_code: "USD",
                value: total.toFixed(2)
              }
            }
          },
          items: cartToPayPalItems(cart)
        }
      ]
    };

    const response = await fetch(`${getPayPalBaseUrl()}/v2/checkout/orders`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(orderPayload)
    });

    const data = await response.json();

    if (!response.ok || !data.id) {
      return res.status(response.status || 500).json({
        error: data.message || data.error_description || "Could not create PayPal order",
        details: data
      });
    }

    res.json({ id: data.id });
  } catch (err) {
    console.error("PayPal create-order error:", err);
    res.status(500).json({ error: err.message || "PayPal create-order failed" });
  }
});

app.post("/api/paypal/capture-order/:orderID", async (req, res) => {
  try {
    const orderID = req.params.orderID;

    if (!orderID) {
      return res.status(400).json({ error: "Missing order ID" });
    }

    const accessToken = await getPayPalAccessToken();

    const response = await fetch(
      `${getPayPalBaseUrl()}/v2/checkout/orders/${orderID}/capture`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        }
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status || 500).json({
        error: data.message || data.error_description || "Could not capture PayPal order",
        details: data
      });
    }

    res.json(data);
  } catch (err) {
    console.error("PayPal capture-order error:", err);
    res.status(500).json({ error: err.message || "PayPal capture failed" });
  }
});

app.post("/api/square/create-payment", async (req, res) => {
  try {
    const sourceId = String(req.body.sourceId || "").trim();
    const cart = req.body.cart || [];
    const customer = req.body.customer || {};
    const total = calculateCartTotal(cart);

    if (!sourceId) {
      return res.status(400).json({ error: "Missing sourceId" });
    }

    if (!Array.isArray(cart) || cart.length === 0 || total <= 0) {
      return res.status(400).json({ error: "Cart is empty or invalid" });
    }

    if (
      !customer.name ||
      !customer.email ||
      !customer.address ||
      !customer.city ||
      !customer.state ||
      !customer.zip
    ) {
      return res.status(400).json({ error: "Customer info is incomplete" });
    }

    if (!process.env.SQUARE_ACCESS_TOKEN || !process.env.SQUARE_LOCATION_ID) {
      return res.status(500).json({ error: "Missing Square server credentials" });
    }

    const squareBaseUrl =
      process.env.SQUARE_MODE === "live"
        ? "https://connect.squareup.com"
        : "https://connect.squareupsandbox.com";

    const squareBody = {
      source_id: sourceId,
      idempotency_key: crypto.randomUUID(),
      location_id: process.env.SQUARE_LOCATION_ID,
      amount_money: {
        amount: Math.round(total * 100),
        currency: "USD"
      },
      autocomplete: true,
      buyer_email_address: customer.email,
      billing_address: {
        address_line_1: customer.address,
        locality: customer.city,
        administrative_district_level_1: customer.state,
        postal_code: customer.zip,
        country: "US"
      },
      note: customer.email ? `Photo order for ${customer.email}` : "Photo order"
    };

    const response = await fetch(`${squareBaseUrl}/v2/payments`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.SQUARE_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
        "Square-Version": "2025-10-16"
      },
      body: JSON.stringify(squareBody)
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status || 500).json({
        error:
          (data.errors && data.errors[0] && data.errors[0].detail) ||
          "Square payment failed",
        details: data
      });
    }

    const paymentId = data?.payment?.id || "";

    await sendOrderEmail({
      paymentId,
      cart,
      customer,
      total
    });

    res.json(data);
  } catch (err) {
    console.error("Square create-payment error:", err);
    res.status(500).json({ error: err.message || "Square create-payment failed" });
  }
});

app.get("*", (req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});