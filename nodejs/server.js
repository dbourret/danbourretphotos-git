const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files (CSS, JS, images, etc.)
app.use(express.static(path.join(__dirname, "public")));

// Single root route
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/__check", (req, res) => res.status(200).send("OK"));

function getPayPalBaseUrl() {
  return process.env.PAYPAL_MODE === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";
}

function getSquareBaseUrl() {
  return process.env.SQUARE_MODE === "live"
    ? "https://connect.squareup.com"
    : "https://connect.squareupsandbox.com";
}

function calculateCartTotal(cart = []) {
  return cart.reduce((sum, item) => {
    const price = Number(item.price) || 0;
    const qty = Number(item.qty) || 1;
    return sum + price * qty;
  }, 0);
}

function toCents(amount) {
  return Math.round(Number(amount) * 100);
}

async function getPayPalAccessToken() {
  const auth = Buffer.from(
    `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`
  ).toString("base64");

  const response = await fetch(`${getPayPalBaseUrl()}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: "grant_type=client_credentials"
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error_description || "Could not get PayPal access token.");
  }

  return data.access_token;
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
    const { cart = [] } = req.body;
    const total = calculateCartTotal(cart).toFixed(2);

    if (!cart.length || Number(total) <= 0) {
      return res.status(400).json({ error: "Cart is empty." });
    }

    const accessToken = await getPayPalAccessToken();

    const response = await fetch(`${getPayPalBaseUrl()}/v2/checkout/orders`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [
          {
            amount: {
              currency_code: "USD",
              value: total
            }
          }
        ]
      })
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(500).json({ error: data.message || "Could not create PayPal order." });
    }

    res.json(data);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message || "PayPal order creation failed." });
  }
});

app.post("/api/paypal/capture-order/:orderId", async (req, res) => {
  try {
    const accessToken = await getPayPalAccessToken();

    const response = await fetch(
      `${getPayPalBaseUrl()}/v2/checkout/orders/${req.params.orderId}/capture`,
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
      return res.status(500).json({ error: data.message || "Could not capture PayPal order." });
    }

    res.json(data);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message || "PayPal capture failed." });
  }
});

app.post("/api/square/payment", async (req, res) => {
  try {
    const { sourceId, cart = [], customer = {} } = req.body;
    const total = calculateCartTotal(cart);

    if (!sourceId) {
      return res.status(400).json({ error: "Missing Square payment token." });
    }

    if (!cart.length || total <= 0) {
      return res.status(400).json({ error: "Cart is empty." });
    }

    const response = await fetch(`${getSquareBaseUrl()}/v2/payments`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.SQUARE_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
        "Square-Version": "2025-01-23"
      },
      body: JSON.stringify({
        source_id: sourceId,
        idempotency_key: crypto.randomUUID(),
        amount_money: {
          amount: toCents(total),
          currency: "USD"
        },
        autocomplete: true,
        buyer_email_address: customer.email || undefined,
        billing_address: {
          address_line_1: customer.address || undefined,
          locality: customer.city || undefined,
          administrative_district_level_1: customer.state || undefined,
          postal_code: customer.zip || undefined,
          country: "US"
        }
      })
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(500).json({
        error: data.errors?.[0]?.detail || "Square payment failed."
      });
    }

    res.json(data);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message || "Square payment failed." });
  }
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
