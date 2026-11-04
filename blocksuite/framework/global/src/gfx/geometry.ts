// Pure geometry shared by the editor and native document services.
export { rotatePoints } from './math.js';
export { Bound } from './model/bound.js';
export {
  getBoundFromPoints,
  inflateBound,
  transformPointsToNewBound,
} from './pure-bound.js';
export type { SerializedXYWH } from './xywh.js';
