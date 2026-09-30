import {
  GRAPH_HEIGHT,
  relationConnector,
  type RelationGroup,
} from './collaboration-graph-model';

const ROW_HEIGHT = 88;
const GROUP_GAP = 48;
const PADDING = 64;

/** World geometry is independent of viewport size, zoom, and status updates. */
export function layoutRelations(
  groups: RelationGroup[],
  expandedKeys: ReadonlySet<string>
) {
  const left = groups.filter(group => group.side === 'left');
  const right = groups.filter(group => group.side === 'right');
  const both = left.length > 0 && right.length > 0;
  const width = both ? 1100 : 900;
  const labelWidth = both ? 280 : 440;
  const groupHeight = (group: RelationGroup) =>
    expandedKeys.has(group.key)
      ? Math.max(112, group.items.length * ROW_HEIGHT + 48)
      : 112;
  const sideHeight = (side: RelationGroup[]) =>
    side.reduce((sum, group) => sum + groupHeight(group), 0) +
    Math.max(0, side.length - 1) * GROUP_GAP;
  const height = Math.max(
    GRAPH_HEIGHT,
    Math.max(sideHeight(left), sideHeight(right)) + PADDING * 2
  );
  const self = {
    x: both ? width / 2 : left.length ? width - PADDING : PADDING,
    y: height / 2,
  };
  const nodes = [left, right].flatMap(side => {
    let top = (height - sideHeight(side)) / 2;
    return side.map(group => {
      const blockHeight = groupHeight(group);
      const y = top + blockHeight / 2;
      top += blockHeight + GROUP_GAP;
      return {
        group,
        x: group.side === 'left' ? PADDING : width - PADDING,
        y,
        top: y - blockHeight / 2,
        height: blockHeight,
        expanded: expandedKeys.has(group.key),
      };
    });
  });
  const lines = nodes.flatMap(node => {
    const items = node.expanded
      ? node.group.items
      : node.group.items.slice(0, 1);
    return items.map((item, index) => {
      const y = node.y + (index - (items.length - 1) / 2) * ROW_HEIGHT;
      const leftPoint =
        node.group.side === 'left'
          ? { x: node.x + 24, y: node.y }
          : { x: self.x + 24, y: self.y };
      const rightPoint =
        node.group.side === 'left'
          ? { x: self.x - 24, y: self.y }
          : { x: node.x - 24, y: node.y };
      const connector = relationConnector(leftPoint, rightPoint, labelWidth, y);
      return {
        node,
        item,
        y,
        connector,
        rect: {
          x: connector.x - labelWidth / 2,
          y: y - 24,
          width: labelWidth,
          height: 48,
        },
      };
    });
  });
  const signature = JSON.stringify(
    groups.map(group => [
      group.key,
      expandedKeys.has(group.key),
      group.items.map(item => item.id),
    ])
  );
  return { width, height, self, nodes, lines, labelWidth, signature, both };
}
