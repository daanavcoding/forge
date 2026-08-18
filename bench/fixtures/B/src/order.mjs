export function createOrder({ id, lines }) {
  return { id, lines: lines.map((line) => ({ ...line })) };
}

export function orderSubtotal(order) {
  return order.lines.reduce((total, line) => total + line.unitCents * line.quantity, 0);
}
