import { describe, expect, test } from 'vitest';

import {
  constrainGraphCamera,
  constrainGraphPosition,
  fitGraphZoom,
  panGraphCamera,
  revealGraphRect,
} from './collaboration-graph-camera';

const bounds = {
  width: 900,
  height: 520,
  contentWidth: 900,
  contentHeight: 2232,
};

describe('finite graph camera', () => {
  test('resizing and revealing preserve a prior fitted scale below the new zoom-out limit', () => {
    const camera = { x: 450, y: 260, zoom: 0.35 };
    const resized = { ...bounds, contentHeight: 520 };
    expect(constrainGraphPosition(camera, resized)).toEqual(camera);
    expect(panGraphCamera(camera, 1000, -1000, resized)).toEqual(camera);
    expect(
      revealGraphRect(
        camera,
        { x: 230, y: 236, width: 440, height: 48 },
        resized
      )
    ).toEqual(camera);
  });
  test('the minimum scale fits the entire long graph, with no fixed 50% floor', () => {
    const zoom = fitGraphZoom(bounds);
    expect(zoom).toBeLessThan(0.25);
    expect(bounds.contentHeight * zoom).toBeCloseTo(bounds.height);
    expect(
      constrainGraphCamera({ x: -1000, y: 99999, zoom: 0 }, bounds)
    ).toEqual({ x: 450, y: 1116, zoom });
  });
  test('a short graph can still zoom out to 50% without drifting into empty space', () => {
    expect(
      constrainGraphCamera(
        { x: -1000, y: 9000, zoom: 0.2 },
        { ...bounds, contentHeight: 520 }
      )
    ).toEqual({ x: 450, y: 260, zoom: 0.5 });
  });
  test('camera movement is bounded at every edge and small content stays centred', () => {
    const camera = { x: 450, y: 1116, zoom: 2 };
    expect(panGraphCamera(camera, 1e6, 1e6, bounds)).toEqual({
      x: 225,
      y: 130,
      zoom: 2,
    });
    expect(panGraphCamera(camera, -1e6, -1e6, bounds)).toEqual({
      x: 675,
      y: 2102,
      zoom: 2,
    });
    expect(
      constrainGraphCamera(camera, {
        ...bounds,
        contentWidth: 100,
        contentHeight: 100,
      })
    ).toEqual({ x: 50, y: 50, zoom: 2 });
  });
  test('zooming preserves the world point at the viewport centre and caps at 200%', () => {
    const camera = { x: 450, y: 1000, zoom: 1 };
    expect(constrainGraphCamera({ ...camera, zoom: 1.5 }, bounds)).toEqual({
      ...camera,
      zoom: 1.5,
    });
    expect(constrainGraphCamera({ ...camera, zoom: 9 }, bounds)).toEqual({
      ...camera,
      zoom: 2,
    });
  });
  test('selecting an already visible summary does not move the camera', () => {
    const camera = { x: 450, y: 1000, zoom: 1.2 };
    expect(
      revealGraphRect(
        camera,
        { x: 230, y: 976, width: 440, height: 48 },
        bounds
      )
    ).toEqual(camera);
  });
  test('offscreen selection pans only enough to reveal it and preserves zoom', () => {
    const camera = { x: 450, y: 260, zoom: 1.2 };
    const rect = { x: 230, y: 2136, width: 440, height: 48 };
    const revealed = revealGraphRect(camera, rect, bounds);
    expect(revealed.zoom).toBe(1.2);
    expect(revealed.x).toBe(450);
    expect(
      (rect.y + rect.height - revealed.y) * revealed.zoom + bounds.height / 2
    ).toBeCloseTo(bounds.height - 16);
  });
  test('a summary wider than a zoomed viewport is centred without an implicit zoom reset', () => {
    const camera = { x: 400, y: 700, zoom: 2 };
    expect(
      revealGraphRect(
        camera,
        { x: 230, y: 676, width: 440, height: 48 },
        { ...bounds, width: 390 }
      )
    ).toEqual({ ...camera, x: 450 });
  });
});
