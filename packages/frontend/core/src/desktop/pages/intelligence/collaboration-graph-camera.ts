export type GraphCamera = { x: number; y: number; zoom: number };
export type GraphBounds = {
  width: number;
  height: number;
  contentWidth: number;
  contentHeight: number;
};
export type GraphRect = { x: number; y: number; width: number; height: number };

export const MAX_GRAPH_ZOOM = 2;
export const fitGraphZoom = (bounds: GraphBounds) =>
  Math.min(
    1,
    bounds.width / bounds.contentWidth,
    bounds.height / bounds.contentHeight
  );

export const minGraphZoom = (bounds: GraphBounds) =>
  Math.min(0.5, fitGraphZoom(bounds));

/** Camera coordinates are the world point at the viewport's centre. */
export function constrainGraphCamera(
  camera: GraphCamera,
  bounds: GraphBounds
): GraphCamera {
  const zoom = Math.max(
    minGraphZoom(bounds),
    Math.min(MAX_GRAPH_ZOOM, camera.zoom)
  );
  return constrainGraphPosition({ ...camera, zoom }, bounds);
}

/** Resizing, panning and selection never change an already valid scale. */
export function constrainGraphPosition(
  camera: GraphCamera,
  bounds: GraphBounds
): GraphCamera {
  const { zoom } = camera;
  const constrain = (value: number, content: number, viewport: number) => {
    const half = viewport / zoom / 2;
    return content <= half * 2
      ? content / 2
      : Math.max(half, Math.min(content - half, value));
  };
  return {
    x: constrain(camera.x, bounds.contentWidth, bounds.width),
    y: constrain(camera.y, bounds.contentHeight, bounds.height),
    zoom,
  };
}

export function panGraphCamera(
  camera: GraphCamera,
  dx: number,
  dy: number,
  bounds: GraphBounds
) {
  return constrainGraphPosition(
    {
      ...camera,
      x: camera.x - dx / camera.zoom,
      y: camera.y - dy / camera.zoom,
    },
    bounds
  );
}

/** Reveal only the obscured edges, keeping the user's scale and visible items still. */
export function revealGraphRect(
  camera: GraphCamera,
  rect: GraphRect,
  bounds: GraphBounds
) {
  const reveal = (
    centre: number,
    size: number,
    start: number,
    length: number
  ) => {
    const half = Math.max(0, size / 2 - 16) / camera.zoom;
    if (length > half * 2) return start + length / 2;
    if (start < centre - half) return start + half;
    if (start + length > centre + half) return start + length - half;
    return centre;
  };
  return constrainGraphPosition(
    {
      ...camera,
      x: reveal(camera.x, bounds.width, rect.x, rect.width),
      y: reveal(camera.y, bounds.height, rect.y, rect.height),
    },
    bounds
  );
}
