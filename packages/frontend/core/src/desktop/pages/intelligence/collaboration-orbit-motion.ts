import {
  ORDER_DOT_DIAMETER,
  type OrderCardLayout,
  orderRingRadius,
} from './collaboration-orbit-model';

export const ORDER_ORBIT_MS = 2000 / 1.5 / 1.5 / 2 / 0.7 / 0.7 / 0.7;
export const ORDER_GLIDE_MS = 400;
export const ORDER_MORPH_MS = 640;
export const ORDER_TRANSFER_MS = Math.max(ORDER_GLIDE_MS, ORDER_MORPH_MS);
export const ORDER_ENTER_MS = ORDER_ORBIT_MS + ORDER_TRANSFER_MS;
export const ORDER_EXIT_MS = 160;
// At most six balls share the 50px orbit, leaving over 6px between their edges.
export const ORDER_LAUNCH_GAP_MS = Math.ceil(ORDER_ORBIT_MS / 6);
export const ORDER_TITLE_OFFSET =
  (ORDER_ORBIT_MS + ORDER_MORPH_MS * 0.25) / ORDER_ENTER_MS;

const clamp = (value: number) => Math.max(0, Math.min(1, value));
/** Zero velocity and acceleration at both ends, with a single speed peak. */
const settle = (value: number) => {
  const t = clamp(value);
  return t * t * t * (t * (t * 6 - 15) + 10);
};
/** Gentle acceleration preserves launch order; the exit speed stays one. */
const orbitProgress = (value: number) => {
  const t = clamp(value);
  return 0.9 * t + 0.1 * t * t * t * (t * (3 * t - 8) + 6);
};
/** Starts at unit speed, matching the orbit's tangent, and settles on landing. */
const glideProgress = (value: number) => {
  const t = clamp(value);
  return t + t * t - t * t * t;
};
const mix = (from: number, to: number, progress: number) =>
  from + (to - from) * progress;
const pixel = (value: number) => Math.round(value * 10000) / 10000;
const spring = (value: number, damping = 6, frequency = 10) => {
  const response = (t: number) =>
    1 -
    Math.exp(-damping * t) *
      (Math.cos(frequency * t) +
        (damping / frequency) * Math.sin(frequency * t));
  return response(clamp(value)) / response(1);
};
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
  const exitSpeed = (sweep * radius) / ORDER_ORBIT_MS;
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
    100,
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
      const morph = spring(morphTime);
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
      // Fade the fill during the last 100 ms of orbit, before capsule growth.
      const fill = 1 - settle((time - ORDER_ORBIT_MS + 100) / 100);
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
        opacity: settle(time / 100),
      };
    });
}
