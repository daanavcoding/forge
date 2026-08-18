import { orderSubtotal } from "./order.mjs";

export function priceOrder(order) {
  const subtotal = orderSubtotal(order);
  return { subtotal, total: subtotal };
}
