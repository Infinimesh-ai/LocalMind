import { Bound, getIBoundFromPoints, type IBound } from './model/bound.js';
import type { IVec } from './model/vec.js';

export function getBoundFromPoints(points: IVec[]) {
  return Bound.from(getIBoundFromPoints(points));
}

export function inflateBound(bound: IBound, delta: number) {
  const half = delta / 2;

  const newBound = new Bound(
    bound.x - half,
    bound.y - half,
    bound.w + delta,
    bound.h + delta
  );

  if (newBound.w <= 0 || newBound.h <= 0) {
    throw new Error('Invalid delta range or bound size.');
  }

  return newBound;
}

export function transformPointsToNewBound<T extends { x: number; y: number }>(
  points: T[],
  oldBound: IBound,
  oldMargin: number,
  newBound: IBound,
  newMargin: number
) {
  const wholeOldMargin = oldMargin * 2;
  const wholeNewMargin = newMargin * 2;
  const oldW = Math.max(oldBound.w - wholeOldMargin, 1);
  const oldH = Math.max(oldBound.h - wholeOldMargin, 1);
  const newW = Math.max(newBound.w - wholeNewMargin, 1);
  const newH = Math.max(newBound.h - wholeNewMargin, 1);

  const transformedPoints = points.map(p => {
    return {
      ...p,
      x: newW * ((p.x - oldMargin) / oldW) + newMargin,
      y: newH * ((p.y - oldMargin) / oldH) + newMargin,
    } as T;
  });

  return {
    points: transformedPoints,
    bound: new Bound(
      newBound.x,
      newBound.y,
      newW + wholeNewMargin,
      newH + wholeNewMargin
    ),
  };
}
