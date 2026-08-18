import assert from "node:assert/strict";
import test from "node:test";
import { createOrder } from "../src/order.mjs";
import { priceOrder } from "../src/pricing.mjs";
import { renderInvoice } from "../src/invoice.mjs";

const order = () => createOrder({ id: "o-1", lines: [
  { sku: "a", unitCents: 1000, quantity: 2 },
  { sku: "b", unitCents: 500, quantity: 1 },
] });

test("subtotal is unchanged without a discount", () => {
  const priced = priceOrder(order());
  assert.equal(priced.subtotal, 2500);
  assert.equal(priced.total, 2500);
});

test("a percentage discount reduces the total but not the subtotal", () => {
  const priced = priceOrder(order(), { discountPercent: 10 });
  assert.equal(priced.subtotal, 2500);
  assert.equal(priced.discount, 250);
  assert.equal(priced.total, 2250);
});

test("the discount rounds half up to whole cents", () => {
  const single = createOrder({ id: "o-2", lines: [{ sku: "a", unitCents: 105, quantity: 1 }] });
  assert.equal(priceOrder(single, { discountPercent: 5 }).discount, 6);
});

test("the invoice reports the discount it applied", () => {
  const invoice = renderInvoice(order(), { discountPercent: 10 });
  assert.equal(invoice.subtotal_cents, 2500);
  assert.equal(invoice.discount_cents, 250);
  assert.equal(invoice.total_cents, 2250);
});
