import { useId } from 'react';

import * as styles from './collaboration-orbit.css';
import { deliveryPath } from './collaboration-orbit-model';

export function CollaborationOrbitLine({
  self,
  node,
  direction,
  both,
  phase,
  gradientId,
  zoom,
}: {
  self: { x: number; y: number };
  node: { x: number; y: number; diameter: number };
  direction: 'incoming' | 'outgoing';
  both: boolean;
  phase: number;
  gradientId: string;
  zoom: number;
}) {
  const maskId = `orbit-delivery-${useId().replaceAll(':', '')}`;
  const path = deliveryPath(self, node, direction === 'incoming', both);
  const distance =
    Math.hypot(node.x - self.x, node.y - self.y) - 78 - node.diameter / 2;
  const duration = Math.max(1, distance / 64);
  const begin = `${-(phase % duration)}s`;
  const beamLength = 110 / zoom;
  const beamHeight = Math.max(16, 16 / zoom);
  const padding = Math.max(24, beamHeight / 2);

  return (
    <g data-direction={direction}>
      <defs>
        <mask
          id={maskId}
          maskUnits="userSpaceOnUse"
          maskContentUnits="userSpaceOnUse"
          x={Math.min(self.x, node.x) - padding}
          y={Math.min(self.y, node.y) - padding}
          width={Math.abs(node.x - self.x) + padding * 2}
          height={Math.abs(node.y - self.y) + padding * 2}
        >
          <g opacity="0">
            <animateMotion
              path={path}
              rotate="auto"
              dur={`${duration}s`}
              begin={begin}
              repeatCount="indefinite"
              calcMode="linear"
              keyPoints="0;1"
              keyTimes="0;1"
            />
            <animate
              attributeName="opacity"
              values="0;1;1;0"
              keyTimes="0;0.12;0.88;1"
              dur={`${duration}s`}
              begin={begin}
              repeatCount="indefinite"
            />
            <rect
              x={-beamLength / 2}
              y={-beamHeight / 2}
              width={beamLength}
              height={beamHeight}
              fill={`url(#${gradientId})`}
            />
          </g>
        </mask>
      </defs>
      <path className={styles.deliveryTrack} d={path} strokeWidth={1 / zoom} />
      <path
        className={styles.deliveryFlow}
        d={path}
        strokeWidth={1.5 / zoom}
        mask={`url(#${maskId})`}
      />
    </g>
  );
}
