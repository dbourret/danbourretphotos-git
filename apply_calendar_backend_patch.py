#!/usr/bin/env python3
"""Patch Dan Bourret Photos server.js to support manually fulfilled calendar orders.

Usage from the repository root:
    python apply_calendar_backend_patch.py nodejs/server.js

The script creates server.js.before-calendar.bak before changing anything.
"""

from __future__ import annotations

import re
import shutil
import sys
from pathlib import Path

CALENDAR_HELPERS = r'''

// ----------------------------------
// 2027 CALENDAR PRODUCT
// Calendar orders use Square checkout but are fulfilled manually,
// so they must not be submitted to WHCC or validated as S3 print files.
// ----------------------------------
const CALENDAR_PRODUCT_PRICE = 22;

function isCalendarItem(item = {}) {
  const material = String(item.material || "").trim().toLowerCase();
  const size = String(item.size || "").trim().toLowerCase();
  const productType = String(item.productType || "").trim().toLowerCase();

  return (
    productType === "calendar" ||
    (material === "calendar" && size === "2027")
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
'''

ESTIMATE_FUNCTION = r'''async function estimateWhccCostsFromItems(items) {
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
}'''

TOTAL_FUNCTION = r'''async function calculateOrderTotal(items) {
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
}'''

MANUAL_REVIEW_BLOCK = r'''

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
'''


def replace_once(text: str, pattern: str, replacement: str, description: str, flags: int = 0) -> str:
    updated, count = re.subn(pattern, replacement, text, count=1, flags=flags)
    if count != 1:
        raise RuntimeError(f"Could not apply patch: {description} (matches found: {count})")
    return updated


def main() -> int:
    if len(sys.argv) != 2:
        print("Usage: python apply_calendar_backend_patch.py path/to/server.js")
        return 2

    target = Path(sys.argv[1]).expanduser().resolve()
    if not target.is_file():
        print(f"server.js not found: {target}")
        return 2

    text = target.read_text(encoding="utf-8")

    if "CALENDAR_PRODUCT_PRICE" in text:
        print("Calendar backend patch is already present; no changes made.")
        return 0

    # Insert calendar helpers after the existing finish normalizer.
    text = replace_once(
        text,
        r'(function\s+normalizeFinishForDb\s*\(finish\s*=\s*""\)\s*\{.*?\n\})',
        r'\1' + CALENDAR_HELPERS,
        "calendar helper insertion",
        flags=re.S,
    )

    # Replace WHCC cost estimation so calendar items are excluded.
    text = replace_once(
        text,
        r'async\s+function\s+estimateWhccCostsFromItems\s*\(items\)\s*\{.*?\n\}\s*\n\s*function\s+checkAdmin',
        ESTIMATE_FUNCTION + "\n\nfunction checkAdmin",
        "WHCC estimate function",
        flags=re.S,
    )

    # Replace total calculation so the fixed $22 server-side price is used.
    text = replace_once(
        text,
        r'async\s+function\s+calculateOrderTotal\s*\(items\)\s*\{.*?\n\}\s*\n\s*app\.post\("/api/contact"',
        TOTAL_FUNCTION + '\n\napp.post("/api/contact"',
        "order total function",
        flags=re.S,
    )

    # Calendar previews are local storefront images, not WHCC source files in S3.
    text = replace_once(
        text,
        r'(for\s*\(const\s+item\s+of\s+orderDetails\.items\)\s*\{\s*)(const\s+exists\s*=\s*await\s+verifyS3ObjectExists)',
        r'\1if (isCalendarItem(item)) {\n        logOrder("[S3 SKIPPED] Calendar item uses manual fulfillment");\n        continue;\n      }\n\n      \2',
        "S3 calendar bypass",
        flags=re.S,
    )

    # Use the wrapper: print products still go to WHCC; calendars do not.
    text = replace_once(
        text,
        r'whccResult\s*=\s*await\s+fulfillOrderWithWhcc\s*\(',
        'whccResult = await fulfillOrderWithWhccOrManual(',
        "WHCC fulfillment wrapper",
    )

    # Flag calendar orders in the existing admin order list.
    text = replace_once(
        text,
        r'(\n\s*\}\s*catch\s*\(whccError\)\s*\{)',
        MANUAL_REVIEW_BLOCK + r'\1',
        "manual-review flag",
        flags=re.S,
    )

    backup = target.with_name(target.name + ".before-calendar.bak")
    if not backup.exists():
        shutil.copy2(target, backup)

    target.write_text(text, encoding="utf-8")
    print(f"Patched: {target}")
    print(f"Backup:  {backup}")
    print("Calendar orders will use Square payment and be flagged for manual fulfillment.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
