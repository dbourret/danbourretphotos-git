import crypto from "crypto";
import nodemailer from "nodemailer";

const SQUARE_BASE_URL =
  process.env.SQUARE_ENV === "production"
    ? "https://connect.squareup.com"
    : "https://connect.squareupsandbox.com";

function toCents(value) {
  return Math.round(Number(value || 0) * 100);
}

function sanitizeCart(cart) {
  if (!Array.isArray(cart)) return [];

  return cart.map((item) => ({
    photo: String(item.photo || "").trim(),
    category: String(item.category || "").trim(),
    format: String(item.format || "").trim(),
    size: String(item.size || "").trim(),
    image: String(item.image || "").trim(),
    qty: Math.max(1, Number(item.qty || 1)),
    price: Number(item.price || 0)
  }));
}

function calculateAmount(cart) {
  return cart.reduce((sum, item) => {
    return sum + Number(item.price || 0) * Number(item.qty || 1);
  }, 0);
}

function sanitizeCustomer(customer) {
  return {
    name: String(customer?.name || "").trim(),
    email: String(customer?.email || "").trim(),
    phone: String(customer?.phone || "").trim(),
    address: String(customer?.address || "").trim(),
    city: String(customer?.city || "").trim(),
    state: String(customer?.state || "").trim(),
    zip: String(customer?.zip || "").trim()
  };
}

function validateOrder(cart, customer, sourceId) {
  if (!sourceId) return "Missing sourceId";
  if (!Array.isArray(cart) || cart.length === 0) return "Cart is empty";

  if (
    !customer.name ||
    !customer.email ||
    !customer.address ||
    !customer.city ||
    !customer.state ||
    !customer.zip
  ) {
    return "Customer info is incomplete";
  }

  return null;
}

function formatMoney(amountCents, currency = "USD") {
  return `${currency} ${(amountCents / 100).toFixed(2)}`;
}

function buildOrderEmail({ referenceId, payment, cart, customer }) {
  const lines = cart
    .map((item) => {
      const lineTotal = toCents(item.price) * item.qty;
      return [
        `${item.qty} x ${item.photo || "Untitled photo"}`,
        `Format: ${item.format || "N/A"}`,
        `Size: ${item.size || "N/A"}`,
        `Unit Price: $${Number(item.price || 0).toFixed(2)}`,
        `Line Total: $${(lineTotal / 100).toFixed(2)}`
      ].join("\n");
    })
    .join("\n\n");

  const amountMoney = payment?.amount_money || {};
  const amount = Number(amountMoney.amount || 0);
  const currency = amountMoney.currency || "USD";

  return `
New paid order received

Reference ID: ${referenceId}
Square Payment ID: ${payment?.id || "N/A"}
Payment Status: ${payment?.status || "N/A"}
Total Paid: ${formatMoney(amount, currency)}

Customer
--------
Name: ${customer.name}
Email: ${customer.email}
Phone: ${customer.phone || "N/A"}

Shipping Address
----------------
${customer.address}
${customer.city}, ${customer.state} ${customer.zip}

Items
-----
${lines}
  `.trim();
}

async function sendOrderEmail({ referenceId, payment, cart, customer }) {
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

  const text = buildOrderEmail({ referenceId, payment, cart, customer });

  await transporter.sendMail({
    from: process.env.ORDER_FROM_EMAIL,
    to: process.env.ORDER_NOTIFY_EMAIL,
    subject: `New order paid: ${referenceId}`,
    text,
    replyTo: customer.email || undefined
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!process.env.SQUARE_ACCESS_TOKEN) {
    return res.status(500).json({ error: "Missing Square access token" });
  }

  try {
    const sourceId = String(req.body?.sourceId || "").trim();
    const cart = sanitizeCart(req.body?.cart);
    const customer = sanitizeCustomer(req.body?.customer);

    const validationError = validateOrder(cart, customer, sourceId);
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    const total = calculateAmount(cart);
    const amountCents = toCents(total);

    if (amountCents <= 0) {
      return res.status(400).json({ error: "Invalid cart total" });
    }

    const referenceId = `ORDER-${Date.now()}`;
    const idempotencyKey = crypto.randomUUID();

    const squarePayload = {
      source_id: sourceId,
      idempotency_key: idempotencyKey,
      amount_money: {
        amount: amountCents,
        currency: "USD"
      },
      autocomplete: true,
      reference_id: referenceId,
      buyer_email_address: customer.email,
      billing_address: {
        address_line_1: customer.address,
        locality: customer.city,
        administrative_district_level_1: customer.state,
        postal_code: customer.zip,
        country: "US"
      },
      buyer_phone_number: customer.phone || undefined,
      note: JSON.stringify({
        customer,
        cart
      }).slice(0, 500)
    };

    const squareRes = await fetch(`${SQUARE_BASE_URL}/v2/payments`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.SQUARE_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
        "Square-Version": "2026-03-18"
      },
      body: JSON.stringify(squarePayload)
    });

    const squareData = await squareRes.json();

    if (!squareRes.ok) {
      const errorMessage =
        squareData?.errors?.map((e) => e.detail || e.code).join(", ") ||
        "Square payment failed";

      return res.status(squareRes.status).json({ error: errorMessage });
    }

    const payment = squareData.payment;

    if (!payment || !payment.id) {
      return res.status(500).json({ error: "Square payment response was incomplete" });
    }

    await sendOrderEmail({
      referenceId,
      payment,
      cart,
      customer
    });

    return res.status(200).json({
      ok: true,
      paymentId: payment.id,
      referenceId,
      status: payment.status
    });
  } catch (error) {
    console.error("Square create-payment error:", error);
    return res.status(500).json({
      error: error.message || "Internal server error"
    });
  }
}