import { describe, expect, test } from 'vitest';

import type { Relation } from './collaboration-graph-model';
import type { OrderCardLayout } from './collaboration-orbit-model';
import {
  layoutOrderCards,
  ORDER_DOT_DIAMETER,
  orderRingRadius,
} from './collaboration-orbit-model';
import {
  ORDER_ENTER_MS,
  ORDER_EXIT_MS,
  ORDER_GLIDE_MS,
  ORDER_LAUNCH_GAP_MS,
  ORDER_MORPH_MS,
  ORDER_ORBIT_MS,
  ORDER_TITLE_OFFSET,
  orderMotionFrames,
} from './collaboration-orbit-motion';

const node = { x: 500, y: 400, diameter: 74 };
const layout = (side: 'left' | 'right'): OrderCardLayout => ({
  side,
  columnCount: 1,
  rect: { x: side === 'right' ? 600 : 124, y: 360, width: 276, height: 40 },
  cards: [
    {
      order: { id: 'one' } as Relation,
      column: 0,
      x: side === 'right' ? 600 : 124,
      y: 360,
      width: 276,
      height: 40,
    },
  ],
});

const at = (frames: Keyframe[], milliseconds: number) =>
  frames.reduce((best, frame) =>
    Math.abs((frame.offset ?? 0) * ORDER_ENTER_MS - milliseconds) <
    Math.abs((best.offset ?? 0) * ORDER_ENTER_MS - milliseconds)
      ? frame
      : best
  );
const position = (frame: Keyframe) => {
  const match = String(frame.transform).match(
    /translate\(([-\d.]+)px, ([-\d.]+)px\)/
  );
  if (!match) throw new Error('Missing motion position');
  return { x: Number(match[1]), y: Number(match[2]) };
};

// Match the browser's linear interpolation, including between sampled frames.
const ballAt = (frames: Keyframe[], time: number) => {
  const next = frames.findIndex(
    frame => (frame.offset ?? 0) * ORDER_ENTER_MS >= time
  );
  const from = frames[Math.max(0, next - 1)];
  const to = frames[next];
  const duration = ((to.offset ?? 0) - (from.offset ?? 0)) * ORDER_ENTER_MS;
  const progress = duration
    ? (time - (from.offset ?? 0) * ORDER_ENTER_MS) / duration
    : 0;
  const start = position(from);
  const end = position(to);
  const diameter =
    Number.parseFloat(String(from.width)) * (1 - progress) +
    Number.parseFloat(String(to.width)) * progress;
  return {
    x: start.x * (1 - progress) + end.x * progress + diameter / 2,
    y: start.y * (1 - progress) + end.y * progress + diameter / 2,
    radius: diameter / 2,
  };
};

describe('collaboration orbit motion', () => {
  test('keeps the locked per-order timing and one independent exit', () => {
    const currentOrbit = 2000 / 1.5 / 1.5 / 2 / 0.7 / 0.7 / 0.7;
    expect(ORDER_LAUNCH_GAP_MS).toBe(216);
    expect(ORDER_LAUNCH_GAP_MS).toBeLessThan(ORDER_ORBIT_MS / 4);
    expect(ORDER_ORBIT_MS).toBeCloseTo(currentOrbit);
    expect(ORDER_GLIDE_MS).toBe(400);
    expect(ORDER_MORPH_MS).toBe(640);
    expect(ORDER_ENTER_MS).toBeCloseTo(currentOrbit + 640);
    expect(ORDER_EXIT_MS).toBe(160);
    expect(ORDER_TITLE_OFFSET).toBeCloseTo(
      (ORDER_ORBIT_MS + ORDER_MORPH_MS * 0.25) / ORDER_ENTER_MS
    );
  });

  test.each(['left', 'right'] as const)(
    '%s orbit stays circular, fans out to its row and morphs while gliding',
    side => {
      const frames = orderMotionFrames(layout(side), node, 0);
      const orbit = frames.filter(
        frame => (frame.offset ?? 0) * ORDER_ENTER_MS <= ORDER_ORBIT_MS
      );
      expect(orbit.length).toBeGreaterThan(ORDER_ORBIT_MS / 16);
      let previousDiameter = 0;
      for (const frame of orbit) {
        expect(frame.width).toBe(frame.height);
        const diameter = Number.parseFloat(String(frame.width));
        expect(diameter).toBeGreaterThanOrEqual(previousDiameter);
        expect(diameter).toBeLessThanOrEqual(ORDER_DOT_DIAMETER);
        previousDiameter = diameter;
      }
      expect(Number.parseFloat(String(orbit[0].width))).toBeLessThan(
        ORDER_DOT_DIAMETER / 4
      );
      const midpoint = Number.parseFloat(
        String(at(frames, ORDER_ORBIT_MS / 2).width)
      );
      expect(midpoint).toBeGreaterThan(ORDER_DOT_DIAMETER / 2);
      expect(midpoint).toBeLessThan(ORDER_DOT_DIAMETER * 0.75);
      expect(at(frames, ORDER_ORBIT_MS).width).toBe('32px');
      const duringGlide = at(frames, ORDER_ORBIT_MS + 200);
      expect(Number.parseFloat(String(duringGlide.width))).toBeGreaterThan(32);
      expect(Number.parseFloat(String(duringGlide.height))).toBeGreaterThan(32);
      expect(duringGlide.backgroundColor).toBe('transparent');
      expect(frames.at(-1)?.transform).toBe('translate(0px, 0px)');
      const before = position(at(frames, ORDER_ORBIT_MS - 15));
      const exit = position(at(frames, ORDER_ORBIT_MS));
      const after = position(at(frames, ORDER_ORBIT_MS + 15));
      expect(Math.hypot(exit.x - before.x, exit.y - before.y)).toBeGreaterThan(
        0
      );
      expect(Math.hypot(after.x - exit.x, after.y - exit.y)).toBeLessThan(35);
      expect(orderRingRadius(node.diameter, 1)).toBeGreaterThan(
        node.diameter / 2 + ORDER_DOT_DIAMETER / 2
      );
    }
  );

  test.each(['left', 'right'] as const)(
    '%s dense orbit fits the scene and stays clear of landed capsules',
    side => {
      for (const count of [1, 5, 12, 20, 30, 33, 40]) {
        const cards = layoutOrderCards(
          { x: node.x + (side === 'left' ? 300 : -300), y: node.y },
          node,
          Array.from({ length: count }, (_, i) => ({
            id: String(i),
          })) as Relation[]
        )!;
        const extent =
          orderRingRadius(node.diameter, count) * 1.08 + ORDER_DOT_DIAMETER / 2;
        if (count > 1) expect(orderRingRadius(node.diameter, count)).toBe(50);
        expect(cards.rect.x).toBeLessThanOrEqual(node.x - extent);
        expect(cards.rect.y).toBeLessThanOrEqual(node.y - extent);
        expect(cards.rect.x + cards.rect.width).toBeGreaterThanOrEqual(
          node.x + extent - 1e-6
        );
        expect(cards.rect.y + cards.rect.height).toBeGreaterThanOrEqual(
          node.y + extent - 1e-6
        );
        for (const card of cards.cards) {
          const clearance =
            side === 'right' ? card.x - node.x : node.x - card.x - card.width;
          expect(clearance).toBeGreaterThanOrEqual(extent + 7.99);
        }
      }
    }
  );

  test.each(['left', 'right'] as const)(
    '%s compact orbit keeps every pair of balls apart, including column changes',
    side => {
      let minimumGap = Infinity;
      // Include small historical-only avatars and multiple five-row columns.
      for (const diameter of [40, 44, 74, 112]) {
        const avatar = { ...node, diameter };
        for (const count of [2, 5, 6, 7, 10, 20, 40]) {
          expect(orderRingRadius(diameter, count)).toBe(50);
          const cards = layoutOrderCards(
            { x: node.x + (side === 'left' ? 300 : -300), y: node.y },
            avatar,
            Array.from({ length: count }, (_, i) => ({
              id: String(i),
            })) as Relation[]
          )!;
          const motions = cards.cards.map((_, i) =>
            orderMotionFrames(cards, avatar, i)
          );
          for (let later = 1; later < count; later++) {
            for (let earlier = 0; earlier < later; earlier++) {
              const delay = (later - earlier) * ORDER_LAUNCH_GAP_MS;
              if (delay >= ORDER_ORBIT_MS) continue;
              for (let sample = 0; sample <= 180; sample++) {
                const time = ((ORDER_ORBIT_MS - delay) * sample) / 180;
                const front = ballAt(motions[earlier], time + delay);
                const back = ballAt(motions[later], time);
                const separation = Math.hypot(
                  front.x +
                    cards.cards[earlier].x -
                    back.x -
                    cards.cards[later].x,
                  front.y +
                    cards.cards[earlier].y -
                    back.y -
                    cards.cards[later].y
                );
                minimumGap = Math.min(
                  minimumGap,
                  separation - front.radius - back.radius
                );
              }
            }
          }
        }
      }
      expect(minimumGap).toBeGreaterThan(6);
    }
  );
});
