export interface DirEntry {
  name: string;
  type: 'file' | 'dir';
  children?: DirEntry[];
}
