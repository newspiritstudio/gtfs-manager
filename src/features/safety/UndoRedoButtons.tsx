import { Redo2, Undo2 } from 'lucide-react';
import IconButton from '@/components/ui/IconButton';
import { useI18n } from '@/lib/i18n/client';
import { useHistory } from './HistoryProvider';

const isMac = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/** Undo and redo for the feed's edits, in the top bar. */
export default function UndoRedoButtons() {
  const { t } = useI18n();
  const { feedId, state, undo, redo } = useHistory();
  if (!feedId) return null;
  const mod = isMac() ? '⌘' : 'Ctrl+';
  return (
    <div className="flex items-center">
      <IconButton
        label={`${t('safety.undo')} (${mod}Z)`}
        disabled={!state?.canUndo}
        onClick={() => void undo()}
      >
        <Undo2 />
      </IconButton>
      <IconButton
        label={`${t('safety.redo')} (${mod}${isMac() ? '⇧Z' : 'Shift+Z'})`}
        disabled={!state?.canRedo}
        onClick={() => void redo()}
      >
        <Redo2 />
      </IconButton>
    </div>
  );
}
