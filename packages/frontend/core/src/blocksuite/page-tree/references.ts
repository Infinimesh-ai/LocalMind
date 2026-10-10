import type { TransformerMiddleware } from '@blocksuite/affine/store';

/** A content copy never transfers the referenced resource's ownership. */
export const subpageReferenceMiddleware: TransformerMiddleware = ({
  slots,
}) => {
  const subscription = slots.beforeImport.subscribe(payload => {
    if (
      payload.type !== 'block' ||
      payload.snapshot.flavour !== 'localmind:subpage'
    )
      return;
    const resourceId = payload.snapshot.props.resourceId;
    if (typeof resourceId !== 'string')
      throw new Error('Invalid subpage reference');
    payload.snapshot.flavour = 'affine:embed-linked-doc';
    payload.snapshot.props = { pageId: resourceId, style: 'horizontal' };
    payload.snapshot.children = [];
  });
  return () => subscription.unsubscribe();
};
