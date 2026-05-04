import type { FeedPost } from '../../types/feed';
import { ChangaImagePost } from './ChangaImagePost';

type Props = {
  post: FeedPost;
  onToggleLike: () => void;
  onOpenProfile: () => void;
  onOpenMessage?: () => void | Promise<void>;
  showMessageButton?: boolean;
  onRequestDelete?: () => void;
  onRequestHide?: () => void;
};

/** Alias de `ChangaImagePost` para no romper imports existentes del feed. */
export function PostCard(props: Props) {
  return <ChangaImagePost {...props} />;
}
