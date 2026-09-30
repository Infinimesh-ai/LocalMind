export interface NodeInfo {
  id: string;
  parentId: string | null;
  type: 'folder' | 'doc' | 'tag' | 'collection' | 'file' | 'office';
  data: string;
  index: string;
}
