import type { PageId } from '../App';
export interface PageProps {
  go: (p: PageId) => void;
}
