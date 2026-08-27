import type { ImgHTMLAttributes } from 'react';

import logoUrl from './localmind-logo.png';

export interface LocalMindLogoProps extends Omit<
  ImgHTMLAttributes<HTMLImageElement>,
  'src' | 'width' | 'height'
> {
  size?: number;
  width?: number;
  height?: number;
}

export const LocalMindLogo = ({
  size,
  width = size,
  height = size,
  alt = '',
  draggable = false,
  style,
  ...props
}: LocalMindLogoProps) => {
  return (
    <img
      src={logoUrl}
      width={width}
      height={height}
      alt={alt}
      aria-hidden={alt ? undefined : true}
      draggable={draggable}
      style={{ objectFit: 'contain', flexShrink: 0, ...style }}
      {...props}
    />
  );
};

export { logoUrl as localMindLogoUrl };
