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
  ORDER_FORM_GAP_MS,
  ORDER_GLIDE_MS,
  ORDER_LAUNCH_GAP_MS,
  ORDER_MORPH_MS,
  ORDER_ORBIT_LIMIT,
  ORDER_ORBIT_MS,
  ORDER_TITLE_OFFSET,
  orderEntrance,
  orderFormFrames,
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
  test('keeps a lap near 0.75 s and each capsule near 1.2 s after its ball', () => {
    expect(ORDER_ORBIT_MS).toBe(750);
    expect(ORDER_ENTER_MS).toBe(1200);
    expect(ORDER_LAUNCH_GAP_MS).toBe(90);
    expect(ORDER_GLIDE_MS).toBeLessThanOrEqual(ORDER_MORPH_MS);
    expect(ORDER_EXIT_MS).toBe(160);
    expect(ORDER_TITLE_OFFSET).toBeCloseTo(
      (ORDER_ORBIT_MS + ORDER_MORPH_MS * 0.45) / ORDER_ENTER_MS
    );
  });

  test('launches at most six balls, then forms the rest after the last exit', () => {
    const entrances = Array.from({ length: 9 }, (_, i) => orderEntrance(9, i));
    expect(entrances.filter(entrance => entrance.orbit)).toHaveLength(
      ORDER_ORBIT_LIMIT
    );
    const lastExit =
      (ORDER_ORBIT_LIMIT - 1) * ORDER_LAUNCH_GAP_MS + ORDER_ORBIT_MS;
    expect(entrances.slice(ORDER_ORBIT_LIMIT).map(e => e.delay)).toEqual([
      lastExit,
      lastExit + ORDER_FORM_GAP_MS,
      lastExit + ORDER_FORM_GAP_MS * 2,
    ]);
    expect(entrances[ORDER_ORBIT_LIMIT].duration).toBe(ORDER_MORPH_MS);
    const frames = orderFormFrames(layout('right'), 0);
    expect(frames[0]).toMatchObject({ width: '32px', opacity: 0 });
    expect(frames.at(-1)).toMatchObject({
      offset: 1,
      width: '276px',
      height: '40px',
      transform: 'translate(0px, 0px)',
      backgroundColor: 'transparent',
    });
    expect(orderFormFrames(layout('left'), 0).at(-1)?.transform).toBe(
      'translate(0px, 0px)'
    );
  });

  test('spins up from rest and leaves the ring at full speed', () => {
    const frames = orderMotionFrames(layout('right'), node, 0);
    const radius = orderRingRadius(node.diameter, 1);
    const angle = (time: number) => {
      const ball = ballAt(frames, time);
      return Math.atan2(
        ball.y + layout('right').cards[0].y - node.y,
        ball.x + layout('right').cards[0].x - node.x
      );
    };
    const speed = (time: number) => {
      let delta = angle(time + 15) - angle(time);
      if (delta < -Math.PI) delta += Math.PI * 2;
      if (delta > Math.PI) delta -= Math.PI * 2;
      return (Math.abs(delta) * radius) / 15;
    };
    const start = speed(0);
    const middle = speed(ORDER_ORBIT_MS / 2);
    const end = speed(ORDER_ORBIT_MS - 30);
    expect(start).toBeLessThan(end / 5);
    expect(middle).toBeGreaterThan(start);
    expect(end).toBeGreaterThan(middle);
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
      expect(String(duringGlide.backgroundColor)).toContain('color-mix');
      expect(
        at(frames, ORDER_ORBIT_MS + ORDER_MORPH_MS * 0.7).backgroundColor
      ).toBe('transparent');
      // The capsule never grows past its final size.
      for (const frame of frames)
        expect(Number.parseFloat(String(frame.width))).toBeLessThanOrEqual(
          276 + 1e-6
        );
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
          for (
            let later = 1;
            later < Math.min(count, ORDER_ORBIT_LIMIT);
            later++
          ) {
            for (let earlier = 0; earlier < later; earlier++) {
              const delay = (later - earlier) * ORDER_LAUNCH_GAP_MS;
              // Include earlier balls that already left the ring and glide across it.
              if (delay >= ORDER_ENTER_MS) continue;
              for (let sample = 0; sample <= 180; sample++) {
                const time =
                  (Math.min(ORDER_ORBIT_MS, ORDER_ENTER_MS - delay) * sample) /
                  180;
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
