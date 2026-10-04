/** The snapped card whose leading edge is closest to the carousel's leading edge. */
export function nearestCarouselIndex(cardLefts: readonly number[], viewportLeft: number): number {
  if (cardLefts.length === 0) return -1;
  let nearest = 0;
  for (let index = 1; index < cardLefts.length; index++) {
    if (Math.abs(cardLefts[index] - viewportLeft) < Math.abs(cardLefts[nearest] - viewportLeft)) {
      nearest = index;
    }
  }
  return nearest;
}
