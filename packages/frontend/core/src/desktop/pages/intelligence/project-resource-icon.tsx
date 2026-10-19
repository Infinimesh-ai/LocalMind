import { ProjectResourceKind } from '@affine/graphql';
import {
  AttachmentIcon,
  EdgelessIcon,
  ExportToPdfIcon,
  FileIcon,
  FolderIcon,
  PageIcon,
  TableIcon,
  TextIcon,
  ViewIcon,
} from '@blocksuite/icons/rc';

export function ProjectResourceIcon({
  kind,
  title = '',
}: {
  kind: ProjectResourceKind;
  title?: string;
}) {
  const icons = {
    [ProjectResourceKind.folder]: FolderIcon,
    [ProjectResourceKind.page]: PageIcon,
    [ProjectResourceKind.edgeless]: EdgelessIcon,
    [ProjectResourceKind.document]: FileIcon,
    [ProjectResourceKind.workbook]: TableIcon,
    [ProjectResourceKind.presentation]: ViewIcon,
    [ProjectResourceKind.pdf]: ExportToPdfIcon,
    [ProjectResourceKind.file]: /\.(txt|md|markdown|csv|json)$/i.test(title)
      ? TextIcon
      : AttachmentIcon,
  };
  const Icon = icons[kind] ?? AttachmentIcon;
  return <Icon aria-hidden />;
}
