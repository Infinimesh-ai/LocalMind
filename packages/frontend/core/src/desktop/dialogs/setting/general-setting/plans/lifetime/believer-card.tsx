import { LocalMindLogo } from '@affine/component/localmind-logo';
import clsx from 'clsx';
import type { HTMLAttributes } from 'react';

import { bg, brandMark, card, content } from './believer-card.css';

export const BelieverCard = ({
  children,
  type,
  className,
  ...attrs
}: HTMLAttributes<HTMLDivElement> & {
  type: 1 | 2;
}) => {
  return (
    <div className={clsx(card, className)} data-type={type} {...attrs}>
      <div className={bg} aria-hidden="true">
        <LocalMindLogo className={brandMark} />
      </div>
      <div className={content}>{children}</div>
    </div>
  );
};
