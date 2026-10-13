// Alignment guides while dragging a card, like slide editors: when an edge or the middle of the card
// comes within a few pixels of another card's, the card settles onto it and a thin line shows the
// alignment. Farther away nothing happens, so a card can still be placed freely.
export type Box = { x: number; y: number; width: number; height: number };
export type Guide = { axis: 'x' | 'y'; at: number; from: number; to: number };

const lines = (start: number, size: number) => [start, start + size / 2, start + size];

// Lines of the same kind only: left to left, middle to middle, right to right (top, middle and
// bottom alike). The nearest wins; cards of the same size line up on all three at once, and the
// middle line stands for that.
function snap(moving: number[], others: number[][], threshold: number) {
  let best: { delta: number; index: number } | undefined;
  for (const set of others) for (const index of [0, 1, 2]) {
    const delta = set[index] - moving[index];
    if (Math.abs(delta) > threshold) continue;
    const tie = best && Math.abs(Math.abs(delta) - Math.abs(best.delta)) < 0.01;
    if (!best || (!tie && Math.abs(delta) < Math.abs(best.delta)) || (tie && index === 1)) best = { delta, index };
  }
  return best ?? { delta: 0, index: -1 };
}

// `threshold` is in board units (a few screen pixels divided by the zoom). At most one guide per
// direction: the line the card settled on.
export function alignTo(moving: Box, others: Box[], threshold: number) {
  const sx = snap(lines(moving.x, moving.width), others.map(box => lines(box.x, box.width)), threshold);
  const sy = snap(lines(moving.y, moving.height), others.map(box => lines(box.y, box.height)), threshold);
  const placed = { ...moving, x: moving.x + sx.delta, y: moving.y + sy.delta }, guides: Guide[] = [];
  for (const [axis, index] of [['x', sx.index], ['y', sy.index]] as const) {
    if (index < 0) continue;
    const at = (axis === 'x' ? lines(placed.x, placed.width) : lines(placed.y, placed.height))[index];
    const sharing = others.filter(box => Math.abs((axis === 'x' ? lines(box.x, box.width) : lines(box.y, box.height))[index] - at) < 0.5);
    const all = [placed, ...sharing], start = (box: Box) => axis === 'x' ? box.y : box.x, end = (box: Box) => axis === 'x' ? box.y + box.height : box.x + box.width;
    guides.push({ axis, at, from: Math.min(...all.map(start)), to: Math.max(...all.map(end)) });
  }
  return { dx: sx.delta, dy: sy.delta, guides };
}
