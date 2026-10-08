import {
  ORDER_DOT_DIAMETER,
  type OrderCardLayout,
  orderRingRadius,
} from './collaboration-orbit-model';

// One lap (plus a short overrun to the exit point) takes about 0.75 s, and a
// ball becomes a finished capsule about 1.2 s after it appears.
export const ORDER_ORBIT_MS = 750;
export const ORDER_GLIDE_MS = 420;
export const ORDER_MORPH_MS = 450;
export const ORDER_TRANSFER_MS = Math.max(ORDER_GLIDE_MS, ORDER_MORPH_MS);
export const ORDER_ENTER_MS = ORDER_ORBIT_MS + ORDER_TRANSFER_MS;
export const ORDER_EXIT_MS = 160;
// Only the first few orders launch as balls; the rest form in place afterwards.
export const ORDER_ORBIT_LIMIT = 6;
// The first ball overruns the emitter and flies out across the ring ahead of
// it, so all launches finish before it gets there. Wider gaps put the youngest
// ball in that flight path; narrower ones crowd the emitter.
export const ORDER_LAUNCH_GAP_MS = 90;
export const ORDER_FORM_GAP_MS = 60;
export const ORDER_TITLE_OFFSET =
  (ORDER_ORBIT_MS + ORDER_MORPH_MS * 0.45) / ORDER_ENTER_MS;
export const ORDER_FORM_TITLE_OFFSET = 0.45;

const clamp = (value: number) => Math.max(0, Math.min(1, value));
/** Zero velocity and acceleration at both ends, with a single speed peak. */
const settle = (value: number) => {
  const t = clamp(value);
  return t * t * t * (t * (t * 6 - 15) + 10);
};
// A small launch kick separates consecutive balls at the emitter.
const ORBIT_KICK = 0.2;
/** Spins up from a gentle start and keeps accelerating until flung off the ring. */
const orbitProgress = (value: number) => {
  const t = clamp(value);
  return ORBIT_KICK * t + (1 - ORBIT_KICK) * (1 - Math.cos((t * Math.PI) / 2));
};
// Exit speed as a share of the average lap speed (the slope of orbitProgress).
const ORBIT_EXIT_SPEED = ORBIT_KICK + ((1 - ORBIT_KICK) * Math.PI) / 2;
/** Leaves at the orbit's exit speed along its tangent and settles on landing. */
const glideProgress = (value: number) => {
  const t = clamp(value);
  return t + t * t - t * t * t;
};
const mix = (from: number, to: number, progress: number) =>
  from + (to - from) * progress;
const pixel = (value: number) => Math.round(value * 10000) / 10000;
/** CSS-style cubic-bezier easing, solved for x with Newton steps. */
const cubicBezier = (x1: number, y1: number, x2: number, y2: number) => {
  const curve = (a: number, b: number, s: number) =>
    3 * a * s * (1 - s) ** 2 + 3 * b * s * s * (1 - s) + s ** 3;
  const slope = (a: number, b: number, s: number) =>
    3 * a * (1 - s) ** 2 + 6 * (b - a) * s * (1 - s) + 3 * (1 - b) * s * s;
  return (value: number) => {
    const x = clamp(value);
    let s = x;
    for (let i = 0; i < 8; i++) {
      const d = slope(x1, x2, s);
      if (Math.abs(d) < 1e-6) break;
      s = clamp(s - (curve(x1, x2, s) - x) / d);
    }
    return curve(y1, y2, s);
  };
};
/** Soft start while the dot leaves the ring, then a long overshoot-free settle. */
const stretch = cubicBezier(0.45, 0, 0.15, 1);
const speedEnvelope = (value: number) => {
  const t = clamp(value);
  return 16 * t * t * (1 - t) * (1 - t);
};

/** Each ball launches from one emitter, then settles into an unfilled capsule. */
export function orderMotionFrames(
  layout: OrderCardLayout,
  node: { x: number; y: number; diameter: number },
  index: number
): Keyframe[] {
  const card = layout.cards[index];
  const sign = layout.side === 'right' ? 1 : -1;
  const radius = orderRingRadius(node.diameter, layout.cards.length);
  const angle = -Math.PI / 2;
  // Share one angular path so later rows cannot catch earlier balls on the ring.
  // Each ball then immediately fans out along its own curve to its capsule.
  const sweep = Math.PI * 2 + Math.PI / 6;
  const exitAngle = angle + sign * sweep;
  const start = {
    x: node.x + Math.cos(exitAngle) * radius,
    y: node.y + Math.sin(exitAngle) * radius,
  };
  const end = {
    x:
      layout.side === 'right'
        ? card.x + ORDER_DOT_DIAMETER / 2
        : card.x + card.width - ORDER_DOT_DIAMETER / 2,
    y: card.y + card.height / 2,
  };
  const distance = Math.hypot(end.x - start.x, end.y - start.y);
  const exitSpeed = (sweep * radius * ORBIT_EXIT_SPEED) / ORDER_ORBIT_MS;
  const tangentLength = (exitSpeed * ORDER_GLIDE_MS) / 3;
  const control1 = {
    x: start.x - sign * Math.sin(exitAngle) * tangentLength,
    y: start.y + sign * Math.cos(exitAngle) * tangentLength,
  };
  const control2 = {
    x: end.x - sign * Math.min(100, distance * 0.3),
    y: end.y,
  };
  const morphStart = ORDER_ORBIT_MS;
  const times = new Set([
    0,
    80,
    ORDER_ORBIT_MS / 2,
    ORDER_ORBIT_MS - 15,
    morphStart,
    morphStart + 15,
    morphStart + ORDER_GLIDE_MS,
    ORDER_ENTER_MS,
  ]);
  // The browser interpolates between these sampled positions, shapes and rotations.
  for (let time = 0; time < ORDER_ENTER_MS; time += 15) times.add(time);

  return [...times]
    .sort((a, b) => a - b)
    .map(time => {
      const orbitTime = clamp(time / ORDER_ORBIT_MS);
      const glideTime = clamp((time - ORDER_ORBIT_MS) / ORDER_GLIDE_MS);
      const morphTime = clamp((time - morphStart) / ORDER_MORPH_MS);
      const orbitalSpeed = speedEnvelope(orbitTime);
      const travel = glideProgress(glideTime);
      const morph = stretch(morphTime);
      const growth = mix(0.18, 1, settle(orbitTime));
      let x: number, y: number;
      if (time <= ORDER_ORBIT_MS) {
        const a = angle + sign * sweep * orbitProgress(orbitTime);
        const breathingRadius = radius * (1 + 0.08 * orbitalSpeed);
        x = node.x + Math.cos(a) * breathingRadius;
        y = node.y + Math.sin(a) * breathingRadius;
      } else {
        const r = 1 - travel;
        x =
          r ** 3 * start.x +
          3 * r ** 2 * travel * control1.x +
          3 * r * travel ** 2 * control2.x +
          travel ** 3 * end.x;
        y =
          r ** 3 * start.y +
          3 * r ** 2 * travel * control1.y +
          3 * r * travel ** 2 * control2.y +
          travel ** 3 * end.y;
      }
      const width =
        morphTime > 0
          ? mix(ORDER_DOT_DIAMETER, card.width, morph)
          : ORDER_DOT_DIAMETER * growth;
      const height =
        morphTime > 0
          ? mix(ORDER_DOT_DIAMETER, card.height, morph)
          : ORDER_DOT_DIAMETER * growth;
      if (morphTime > 0) {
        // Grow outward while gliding; the near end settles with the flight path.
        x += (sign * (width - ORDER_DOT_DIAMETER)) / 2;
      }
      // The solid dot dissolves into the outline as it stretches, not before.
      const fill = 1 - settle(morphTime / 0.6);
      const position = `translate(${pixel(x - card.x - width / 2)}px, ${pixel(y - card.y - height / 2)}px)`;
      return {
        offset: time / ORDER_ENTER_MS,
        transform: position,
        width: `${pixel(width)}px`,
        height: `${pixel(height)}px`,
        paddingLeft: `${14 * clamp(morph)}px`,
        paddingRight: `${14 * clamp(morph)}px`,
        backgroundColor:
          fill === 1
            ? 'var(--order-tone)'
            : fill === 0
              ? 'transparent'
              : `color-mix(in srgb, var(--order-tone) ${pixel(fill * 100)}%, transparent)`,
        opacity: settle(time / 80),
      };
    });
}

/** Capsule end nearest the avatar, where a ball lands before stretching. */
function orderFormFrame(
  layout: OrderCardLayout,
  index: number,
  morphTime: number
): Keyframe {
  const card = layout.cards[index];
  const sign = layout.side === 'right' ? 1 : -1;
  const morph = stretch(morphTime);
  const width = mix(ORDER_DOT_DIAMETER, card.width, morph);
  const height = mix(ORDER_DOT_DIAMETER, card.height, morph);
  const x =
    (layout.side === 'right'
      ? ORDER_DOT_DIAMETER / 2
      : card.width - ORDER_DOT_DIAMETER / 2) +
    (sign * (width - ORDER_DOT_DIAMETER)) / 2;
  const fill = 1 - settle(morphTime / 0.6);
  return {
    transform: `translate(${pixel(x - width / 2)}px, ${pixel(card.height / 2 - height / 2)}px)`,
    width: `${pixel(width)}px`,
    height: `${pixel(height)}px`,
    paddingLeft: `${14 * morph}px`,
    paddingRight: `${14 * morph}px`,
    backgroundColor:
      fill === 1
        ? 'var(--order-tone)'
        : fill === 0
          ? 'transparent'
          : `color-mix(in srgb, var(--order-tone) ${pixel(fill * 100)}%, transparent)`,
  };
}

/** Orders beyond the orbit limit pop in as dots and stretch where they land. */
export function orderFormFrames(
  layout: OrderCardLayout,
  index: number
): Keyframe[] {
  const frames: Keyframe[] = [];
  for (let time = 0; time <= ORDER_MORPH_MS; time += 15) {
    const t = Math.min(time, ORDER_MORPH_MS) / ORDER_MORPH_MS;
    frames.push({
      ...orderFormFrame(layout, index, t),
      offset: t,
      opacity: settle(time / 80),
    });
  }
  if (frames.at(-1)?.offset !== 1)
    frames.push({ ...orderFormFrame(layout, index, 1), offset: 1, opacity: 1 });
  return frames;
}

/**
 * Up to six balls orbit in turn; once the last one flies out, the remaining
 * capsules form one after another.
 */
export function orderEntrance(count: number, index: number) {
  const balls = Math.min(count, ORDER_ORBIT_LIMIT);
  if (index < balls)
    return {
      orbit: true,
      delay: index * ORDER_LAUNCH_GAP_MS,
      duration: ORDER_ENTER_MS,
      titleOffset: ORDER_TITLE_OFFSET,
    };
  return {
    orbit: false,
    delay:
      (balls - 1) * ORDER_LAUNCH_GAP_MS +
      ORDER_ORBIT_MS +
      (index - balls) * ORDER_FORM_GAP_MS,
    duration: ORDER_MORPH_MS,
    titleOffset: ORDER_FORM_TITLE_OFFSET,
  };
}
