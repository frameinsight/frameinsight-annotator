import { expect, it } from "vitest";
import { reviewFrameAt } from "./review-utils";

it("maps review seeking to actual irregular source frame times", () => {
  const times = [0, 0.033, 0.12, 0.145, 0.5];
  expect(reviewFrameAt(times, 0)).toBe(0);
  expect(reviewFrameAt(times, 0.119)).toBe(1);
  expect(reviewFrameAt(times, 0.12)).toBe(2);
  expect(reviewFrameAt(times, 0.499)).toBe(3);
  expect(reviewFrameAt(times, 10)).toBe(4);
  expect(reviewFrameAt(times, -1)).toBe(0);
});
