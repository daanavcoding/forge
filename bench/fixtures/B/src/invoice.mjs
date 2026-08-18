import { priceOrder } from "./pricing.mjs";

export function renderInvoice(order) {
  const priced = priceOrder(order);
  return {
    id: order.id,
    subtotal_cents: priced.subtotal,
    total_cents: priced.total,
  };
}
