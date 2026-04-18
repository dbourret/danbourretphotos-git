// whcc.js
// Node 18+ recommended (uses built-in fetch)
console.log("WHCC_NOTIFICATION_EMAIL =", process.env.WHCC_NOTIFICATION_EMAIL);
const { S3Client, GetObjectCommand } = require("@aws-sdk/client-s3");

const s3 = new S3Client({
  region: process.env.AWS_REGION,
});
const crypto = require("crypto");
const { generateSignedImageUrl } = require("./s3");

const WHCC_BASE_URL =
  process.env.WHCC_BASE_URL || "https://sandbox.apps.whcc.com";

const USE_FAKE_WHCC =
  String(process.env.USE_FAKE_WHCC).toLowerCase() === "true";

const WHCC_ENABLE_SUBMIT =
  String(process.env.WHCC_ENABLE_SUBMIT).toLowerCase() === "true";

async function computeS3ImageMd5(bucket, key) {
  const result = await s3.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    }),
  );

  const chunks = [];
  for await (const chunk of result.Body) {
    chunks.push(chunk);
  }

  const buffer = Buffer.concat(chunks);

  return crypto.createHash("md5").update(buffer).digest("hex");
}

function normalizeMaterial(material = "") {
  const m = String(material).trim().toLowerCase();

  if (["metal", "metal print", "metal prints"].includes(m)) return "metal";
  if (["canvas", "canvas print", "canvas prints"].includes(m)) return "canvas";
  if (["wood", "wood print", "wood prints"].includes(m)) return "wood";

  // Treat all paper/poster/photo-paper products as one canonical bucket
  if (
    [
      "poster",
      "poster print",
      "poster prints",
      "print",
      "prints",
      "photo paper",
      "photo print",
      "photo prints",
      "paper",
    ].includes(m)
  ) {
    return "poster";
  }

  return m;
}

function normalizeFinish(finish = "") {
  const f = String(finish).trim().toLowerCase();

  if (["gloss", "glossy"].includes(f)) return "glossy";
  if (["matte", "matt"].includes(f)) return "matte";
  if (["semi-gloss", "semigloss", "semi gloss"].includes(f))
    return "semi-gloss";
  if (["lustre", "luster"].includes(f)) return "lustre";

  return f;
}

function normalizeSize(size = "") {
  return String(size).trim().toLowerCase();
}

function buildWhccKey({ material, size, finish }) {
  return `${normalizeMaterial(material)}|${normalizeSize(size)}|${normalizeFinish(finish)}`;
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function normalizePhone(phone) {
  return (
    String(phone || "")
      .replace(/\D/g, "")
      .slice(0, 20) || null
  );
}

function safeString(value, fallback = null) {
  if (value === undefined || value === null) return fallback;
  const trimmed = String(value).trim();
  return trimmed === "" ? fallback : trimmed;
}

function printedFileNameFromItem(item, index) {
  const raw =
    item.fileName ||
    item.filename ||
    item.title ||
    item.name ||
    `print-${index + 1}`;

  const cleaned = String(raw)
    .trim()
    .replace(/[^\w.-]+/g, "_");

  return /\.(jpg|jpeg|png|tif|tiff)$/i.test(cleaned)
    ? cleaned
    : `${cleaned}.jpg`;
}

function md5Hex(input) {
  return crypto.createHash("md5").update(input).digest("hex");
}

const WHCC_PRODUCT_MAP = {
  // =========================
  // PHOTO PRINTS (your "poster")
  // =========================
  // Required pattern:
  //   PrintingMaterial: 1  -> Paper
  //   Paper: specific paper surface
  //
  // Paper IDs currently used in your map:
  //   lustre -> 5
  //   matte  -> 1614
  //   glossy -> 1613 (Pearl as closest substitute for now)

  "poster|11x14|lustre": {
    productUID: 253,
    options: {
      PrintingMaterial: 1,
      Paper: 5,
    },
  },
  "poster|11x14|matte": {
    productUID: 253,
    options: {
      PrintingMaterial: 1,
      Paper: 1614,
    },
  },
  "poster|11x14|glossy": {
    productUID: 253,
    options: {
      PrintingMaterial: 1,
      Paper: 1613,
    },
  },

  "poster|12x18|lustre": {
    productUID: 920,
    options: {
      PrintingMaterial: 1,
      Paper: 5,
    },
  },
  "poster|12x18|matte": {
    productUID: 920,
    options: {
      PrintingMaterial: 1,
      Paper: 1614,
    },
  },
  "poster|12x18|glossy": {
    productUID: 920,
    options: {
      PrintingMaterial: 1,
      Paper: 1613,
    },
  },

  "poster|16x20|lustre": {
    productUID: 33,
    options: {
      PrintingMaterial: 1,
      Paper: 5,
    },
  },
  "poster|16x20|matte": {
    productUID: 33,
    options: {
      PrintingMaterial: 1,
      Paper: 1614,
    },
  },
  "poster|16x20|glossy": {
    productUID: 33,
    options: {
      PrintingMaterial: 1,
      Paper: 1613,
    },
  },

  "poster|20x30|lustre": {
    productUID: 38,
    options: {
      PrintingMaterial: 1,
      Paper: 5,
    },
  },
  "poster|20x30|matte": {
    productUID: 38,
    options: {
      PrintingMaterial: 1,
      Paper: 1614,
    },
  },
  "poster|20x30|glossy": {
    productUID: 38,
    options: {
      PrintingMaterial: 1,
      Paper: 1613,
    },
  },

  "poster|24x36|lustre": {
    productUID: 40,
    options: {
      PrintingMaterial: 1,
      Paper: 5,
    },
  },
  "poster|24x36|matte": {
    productUID: 40,
    options: {
      PrintingMaterial: 1,
      Paper: 1614,
    },
  },
  "poster|24x36|glossy": {
    productUID: 40,
    options: {
      PrintingMaterial: 1,
      Paper: 1613,
    },
  },

  // =========================
  // WOOD
  // =========================
  // Catalog shows wood prints require BOTH:
  //   Wood Print Printing Media   -> 1875 (1/2" Maple Wood Panel)
  //   Wood Print Mounting Options -> 1876 (Keyhole)

  "wood|5x7|": {
    productUID: 674,
    options: {
      WoodPrintPrintingMedia: 1875,
      WoodPrintMountingOptions: 1876,
    },
  },
  "wood|8x10|": {
    productUID: 677,
    options: {
      WoodPrintPrintingMedia: 1875,
      WoodPrintMountingOptions: 1876,
    },
  },
  "wood|11x14|": {
    productUID: 683,
    options: {
      WoodPrintPrintingMedia: 1875,
      WoodPrintMountingOptions: 1876,
    },
  },
  "wood|12x12|": {
    productUID: 684,
    options: {
      WoodPrintPrintingMedia: 1875,
      WoodPrintMountingOptions: 1876,
    },
  },
  "wood|16x20|": {
    productUID: 688,
    options: {
      WoodPrintPrintingMedia: 1875,
      WoodPrintMountingOptions: 1876,
    },
  },
  "wood|20x30|": {
    productUID: 692,
    options: {
      WoodPrintPrintingMedia: 1875,
      WoodPrintMountingOptions: 1876,
    },
  },

  // =========================
  // METAL
  // Surface IDs from WHCC catalog:
  // 651  = White High Gloss
  // 1720 = White Matte
  // 1974 = White Semi-Gloss
  // 933  = Clear High Gloss
  // 1721 = Clear Matte
  // =========================

  "metal|5x7|glossy": {
    productUID: 371,
    options: { Surface: 651 },
  },
  "metal|5x7|matte": {
    productUID: 371,
    options: { Surface: 1720 },
  },
  "metal|5x7|semi-gloss": {
    productUID: 371,
    options: { Surface: 1974 },
  },

  "metal|8x10|glossy": {
    productUID: 373,
    options: { Surface: 651 },
  },
  "metal|8x10|matte": {
    productUID: 373,
    options: { Surface: 1720 },
  },
  "metal|8x10|semi-gloss": {
    productUID: 373,
    options: { Surface: 1974 },
  },

  "metal|11x14|glossy": {
    productUID: 356,
    options: { Surface: 651 },
  },
  "metal|11x14|matte": {
    productUID: 356,
    options: { Surface: 1720 },
  },
  "metal|11x14|semi-gloss": {
    productUID: 356,
    options: { Surface: 1974 },
  },

  "metal|12x12|glossy": {
    productUID: 357,
    options: { Surface: 651 },
  },
  "metal|12x12|matte": {
    productUID: 357,
    options: { Surface: 1720 },
  },
  "metal|12x12|semi-gloss": {
    productUID: 357,
    options: { Surface: 1974 },
  },

  "metal|16x20|glossy": {
    productUID: 361,
    options: { Surface: 651 },
  },
  "metal|16x20|matte": {
    productUID: 361,
    options: { Surface: 1720 },
  },
  "metal|16x20|semi-gloss": {
    productUID: 361,
    options: { Surface: 1974 },
  },

  "metal|20x24|glossy": {
    productUID: 364,
    options: { Surface: 651 },
  },
  "metal|20x24|matte": {
    productUID: 364,
    options: { Surface: 1720 },
  },
  "metal|20x24|semi-gloss": {
    productUID: 364,
    options: { Surface: 1974 },
  },

  "metal|20x30|glossy": {
    productUID: 365,
    options: { Surface: 651 },
  },
  "metal|20x30|matte": {
    productUID: 365,
    options: { Surface: 1720 },
  },
  "metal|20x30|semi-gloss": {
    productUID: 365,
    options: { Surface: 1974 },
  },

  // =========================
  // CANVAS
  // =========================

  "canvas|8x10|semi-gloss": {
    productUID: 112,
    options: {
      GalleryWrapType: 126,
      GalleryWrapProtection: 134,
      GalleryWrapHangingHardware: 139,
    },
  },
  "canvas|8x10|matte": {
    productUID: 112,
    options: {
      GalleryWrapType: 126,
      GalleryWrapProtection: 131,
      GalleryWrapHangingHardware: 139,
    },
  },

  "canvas|11x14|semi-gloss": {
    productUID: 71,
    options: {
      GalleryWrapType: 126,
      GalleryWrapProtection: 134,
      GalleryWrapHangingHardware: 140,
    },
  },
  "canvas|11x14|matte": {
    productUID: 71,
    options: {
      GalleryWrapType: 126,
      GalleryWrapProtection: 131,
      GalleryWrapHangingHardware: 140,
    },
  },

  "canvas|12x12|semi-gloss": {
    productUID: 72,
    options: {
      GalleryWrapType: 126,
      GalleryWrapProtection: 134,
      GalleryWrapHangingHardware: 140,
    },
  },
  "canvas|12x12|matte": {
    productUID: 72,
    options: {
      GalleryWrapType: 126,
      GalleryWrapProtection: 131,
      GalleryWrapHangingHardware: 140,
    },
  },

  "canvas|16x20|semi-gloss": {
    productUID: 79,
    options: {
      GalleryWrapType: 126,
      GalleryWrapProtection: 134,
      GalleryWrapHangingHardware: 140,
    },
  },
  "canvas|16x20|matte": {
    productUID: 79,
    options: {
      GalleryWrapType: 126,
      GalleryWrapProtection: 131,
      GalleryWrapHangingHardware: 140,
    },
  },

  "canvas|20x30|semi-gloss": {
    productUID: 89,
    options: {
      GalleryWrapType: 126,
      GalleryWrapProtection: 134,
      GalleryWrapHangingHardware: 140,
    },
  },
  "canvas|20x30|matte": {
    productUID: 89,
    options: {
      GalleryWrapType: 126,
      GalleryWrapProtection: 131,
      GalleryWrapHangingHardware: 140,
    },
  },

  "canvas|24x36|semi-gloss": {
    productUID: 97,
    options: {
      GalleryWrapType: 126,
      GalleryWrapProtection: 134,
      GalleryWrapHangingHardware: 141,
    },
  },
  "canvas|24x36|matte": {
    productUID: 97,
    options: {
      GalleryWrapType: 126,
      GalleryWrapProtection: 131,
      GalleryWrapHangingHardware: 141,
    },
  },
};

function validateWHCCMapping(key, mapping) {
  if (!mapping) {
    throw new Error(`❌ WHCC mapping missing for key: ${key}`);
  }

  const productUID = mapping.productUID;

  if (
    productUID == null ||
    productUID === "" ||
    String(productUID).includes("REPLACE")
  ) {
    throw new Error(`❌ WHCC ProductUID not set for key: ${key}`);
  }

  if (typeof mapping.options !== "object" || mapping.options === null) {
    throw new Error(`❌ WHCC options must be an object for key: ${key}`);
  }
}

async function mapCartItemToWhcc(item, index) {
  const imageKey = item.imageKey;
  const signedImageUrl = await generateSignedImageUrl(imageKey, 259200);

  const imageHash = await computeS3ImageMd5(
    process.env.S3_BUCKET_NAME,
    imageKey,
  );

  if (!signedImageUrl) {
    throw new Error(`Failed to generate signed URL for ${imageKey}`);
  }

  console.log("WHCC HASH DEBUG:", {
    imageKey,
    imageHash,
    signedImageUrl,
  });

  console.log("✅ Signed URL created:", {
    title: item.title,
    imageKey,
    signedImageUrl,
  });

  console.log("URL hash:", md5Hex(signedImageUrl));
  console.log("IMAGE hash:", imageHash);

  const key = buildWhccKey({
    material: item.material,
    size: item.size,
    finish: item.finish || "",
  });
  console.log("WHCC key:", key);

  const mapping = WHCC_PRODUCT_MAP[key];
  validateWHCCMapping(key, mapping);

  return {
    ProductUID: mapping.productUID,
    Quantity: Number(item.quantity || 1),
    ItemAssets: [
      {
        AssetPath: signedImageUrl,
        PrintedFileName: printedFileNameFromItem(item, index),
        ImageHash: imageHash,
        AutoRotate: true,
      },
    ],
    ItemAttributes: Object.values(mapping.options || {}).map((attributeId) => ({
      AttributeUID: attributeId,
    })),
  };
}

function buildShipToAddress(customer) {
  return {
    Name: safeString(customer.name),
    Attn: null,
    Addr1: safeString(customer.address),
    Addr2: safeString(customer.address2),
    City: safeString(customer.city),
    State: safeString(customer.state),
    Zip: safeString(customer.zip),
    Country: safeString(customer.country || "US"),
    Phone: normalizePhone(customer.phone),
  };
}

function buildShipFromAddress() {
  return {
    Name: safeString(process.env.WHCC_SHIP_FROM_NAME, "Returns Department"),
    Addr1: safeString(process.env.WHCC_SHIP_FROM_ADDR1),
    Addr2: safeString(process.env.WHCC_SHIP_FROM_ADDR2),
    City: safeString(process.env.WHCC_SHIP_FROM_CITY),
    State: safeString(process.env.WHCC_SHIP_FROM_STATE),
    Zip: safeString(process.env.WHCC_SHIP_FROM_ZIP),
    Country: safeString(process.env.WHCC_SHIP_FROM_COUNTRY, "US"),
    Phone: normalizePhone(process.env.WHCC_SHIP_FROM_PHONE),
  };
}

function buildOrderAttributes(customer, items) {
  const country = String(customer?.country || "US")
    .trim()
    .toUpperCase();

  // Start with drop ship to client
  const attributes = [{ AttributeUID: 96 }];

  // Best-fit default shipping for small US orders
  if (country === "US") {
    const hasOnlySmallFormats =
      Array.isArray(items) &&
      items.every((item) => {
        const size = String(item.size || "").trim();
        return ["5x7", "8x10", "11x14", "12x12"].includes(size);
      });

    attributes.push({
      AttributeUID: hasOnlySmallFormats ? 1719 : 546,
    });
  }

  return attributes;
}

async function buildWhccOrderRequest({ orderId, customer, items }) {
  if (!orderId) throw new Error("buildWhccOrderRequest requires orderId");
  if (!customer) throw new Error("buildWhccOrderRequest requires customer");
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("buildWhccOrderRequest requires at least one item");
  }

  const shipTo = buildShipToAddress(customer);
  const shipFrom = buildShipFromAddress();

  const missingShipFields = [
    "Name",
    "Addr1",
    "City",
    "State",
    "Zip",
    "Country",
  ].filter((field) => !shipTo[field]);

  if (missingShipFields.length) {
    throw new Error(
      `Customer shipping info missing required fields for WHCC: ${missingShipFields.join(", ")}`,
    );
  }

  const missingShipFromFields = [
    "Name",
    "Addr1",
    "City",
    "State",
    "Zip",
    "Country",
  ].filter((field) => !shipFrom[field]);

  if (missingShipFromFields.length) {
    throw new Error(
      `WHCC ship-from env values missing required fields: ${missingShipFromFields.join(", ")}`,
    );
  }

  const orderItems = await Promise.all(
    items.map((item, index) => mapCartItemToWhcc(item, index)),
  );

  return {
    EntryId: String(orderId),
    Orders: [
      {
        SequenceNumber: 1,
        Instructions: null,
        Reference: `OrderID ${orderId}`,
        SendNotificationEmailAddress: safeString(
          process.env.WHCC_NOTIFICATION_EMAIL,
        ),
        SendNotificationEmailToAccount: true,
        ShipToAddress: shipTo,
        ShipFromAddress: shipFrom,
        OrderAttributes: buildOrderAttributes(customer, items),
        OrderItems: orderItems,
      },
    ],
  };
}

function normalizeImageKey(item) {
  if (!item) {
    throw new Error("Missing item for image key");
  }

  if (item.imageKey) {
    return String(item.imageKey).trim();
  }

  if (item.image) {
    // fallback if you ever pass full path like "images/misc/photo.jpg"
    return item.image.split("/").pop();
  }

  throw new Error(`Missing imageKey for item: ${JSON.stringify(item)}`);
}

async function getWhccAccessToken() {
  const consumerKey = requireEnv("WHCC_CONSUMER_KEY").trim();
  const consumerSecret = requireEnv("WHCC_CONSUMER_SECRET").trim();

  const url = new URL("/api/AccessToken", WHCC_BASE_URL);
  url.searchParams.set("grant_type", "consumer_credentials");
  url.searchParams.set("consumer_key", consumerKey);
  url.searchParams.set("consumer_secret", consumerSecret);

  console.log("WHCC auth target:", WHCC_BASE_URL);
  console.log("WHCC key present:", Boolean(process.env.WHCC_CONSUMER_KEY));
  console.log(
    "WHCC secret present:",
    Boolean(process.env.WHCC_CONSUMER_SECRET),
  );
  console.log(
    "WHCC key length:",
    String(process.env.WHCC_CONSUMER_KEY || "").trim().length,
  );
  console.log(
    "WHCC secret length:",
    String(process.env.WHCC_CONSUMER_SECRET || "").trim().length,
  );
  const response = await fetch(url.toString(), {
    method: "GET",
  });

  const text = await response.text();
  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    throw new Error(`WHCC AccessToken failed (${response.status}): ${text}`);
  }

  if (!data || !data.Token) {
    throw new Error(`WHCC AccessToken response did not include Token: ${text}`);
  }

  return data;
}

async function importWhccOrder({ token, orderRequest }) {
  const response = await fetch(`${WHCC_BASE_URL}/api/OrderImport`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(orderRequest),
  });

  const text = await response.text();
  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    throw new Error(`WHCC OrderImport failed (${response.status}): ${text}`);
  }

  if (!data || !data.ConfirmationID) {
    throw new Error(
      `WHCC OrderImport response missing ConfirmationID: ${text}`,
    );
  }

  return data;
}

async function submitWhccOrder({ token, confirmationId }) {
  const response = await fetch(
    `${WHCC_BASE_URL}/api/OrderImport/Submit/${encodeURIComponent(confirmationId)}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Length": "0",
      },
    },
  );

  const text = await response.text();
  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    throw new Error(`WHCC Submit failed (${response.status}): ${text}`);
  }

  return data;
}

function buildFakeWhccResult({ orderId, orderRequest }) {
  const fakeConfirmationId = `FAKE-WHCC-${orderId}-${Date.now()}`;

  return {
    mode: "fake",
    imported: true,
    submitted: false,
    confirmationId: fakeConfirmationId,
    importResponse: {
      ConfirmationID: fakeConfirmationId,
      Confirmation: `Fake WHCC import created for order ${orderId}`,
      NumberOfOrders: orderRequest.Orders.length,
      Received: new Date().toISOString(),
    },
    submitResponse: null,
    requestPreview: orderRequest,
  };
}

async function fulfillOrderWithWhcc({ orderId, customer, items }) {
  const orderRequest = await buildWhccOrderRequest({
    orderId,
    customer,
    items,
  });

  if (USE_FAKE_WHCC) {
    return buildFakeWhccResult({ orderId, orderRequest });
  }

  const tokenData = await getWhccAccessToken();
  const importData = await importWhccOrder({
    token: tokenData.Token,
    orderRequest,
  });

  let submitData = null;

  if (WHCC_ENABLE_SUBMIT) {
    submitData = await submitWhccOrder({
      token: tokenData.Token,
      confirmationId: importData.ConfirmationID,
    });
  }

  return {
    mode: WHCC_ENABLE_SUBMIT ? "live-submit" : "live-import-only",
    imported: true,
    submitted: Boolean(submitData),
    confirmationId: importData.ConfirmationID,
    tokenInfo: {
      clientId: tokenData.ClientId || null,
      expiresAt: tokenData.ExpirationDate || null,
    },
    importResponse: importData,
    submitResponse: submitData,
    requestPreview: orderRequest,
  };
}

module.exports = {
  fulfillOrderWithWhcc,
  buildWhccOrderRequest,
  getWhccAccessToken,
};
