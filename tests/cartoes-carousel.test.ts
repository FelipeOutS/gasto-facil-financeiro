import { describe, expect, test } from "bun:test";
import { nearestCarouselIndex } from "../src/lib/cartoes-carousel";

describe("card carousel selection from native scroll", () => {
  test("handles empty and single-card wallets", () => {
    expect(nearestCarouselIndex([], 12)).toBe(-1);
    expect(nearestCarouselIndex([12], 12)).toBe(0);
  });

  test("picks the visible leading card after a two-card swipe", () => {
    expect(nearestCarouselIndex([12, 400], 12)).toBe(0);
    expect(nearestCarouselIndex([-376, 12], 12)).toBe(1);
  });

  test("can select the middle or last card in a longer wallet", () => {
    expect(nearestCarouselIndex([-376, 12, 400], 12)).toBe(1);
    expect(nearestCarouselIndex([-764, -376, 12], 12)).toBe(2);
  });
});
