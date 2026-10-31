import { useParams } from 'react-router';

/** The feed of the current address (`/feeds/:feedId/...`). */
export function useFeedId(): string {
  return useParams().feedId ?? '';
}
