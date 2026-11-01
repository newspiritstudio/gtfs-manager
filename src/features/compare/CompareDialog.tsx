import { GitCompareArrows } from 'lucide-react';
import { useState } from 'react';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import Select from '@/components/ui/Select';
import { useEngine } from '@/lib/engine';
import { useI18n } from '@/lib/i18n/client';
import { useRouter } from '@/lib/router';

/**
 * Pick the other feed to compare with. The older one (by the start of its period) goes first as
 * the base: the report reads "what changed from the old to the new", and it can be swapped there.
 */
export default function CompareDialog({
  open,
  onClose,
  feedId,
}: {
  open: boolean;
  onClose: () => void;
  feedId: string;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const feeds = useEngine('listFeeds');
  const [other, setOther] = useState('');
  const list = feeds.data ?? [];
  const options = list.filter((f) => f.id !== feedId).map((f) => ({ value: f.id, label: f.name }));

  const go = () => {
    const start = (id: string) => list.find((f) => f.id === id)?.stats?.dateRange?.start ?? '';
    const otherIsOlder =
      start(other) !== '' && start(feedId) !== '' && start(other) < start(feedId);
    router.push(
      otherIsOlder ? `/feeds/${other}/compare/${feedId}` : `/feeds/${feedId}/compare/${other}`
    );
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('compare.title')}
      closeLabel={t('common.close')}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button disabled={!other} onClick={go}>
            <GitCompareArrows />
            {t('compare.action')}
          </Button>
        </>
      }
    >
      {feeds.status === 'ready' && options.length === 0 ? (
        <p className="text-body-medium text-on-surface-variant">{t('compare.needTwoHint')}</p>
      ) : (
        <div className="space-y-3">
          <p className="text-body-medium text-on-surface-variant">{t('compare.pickSubtitle')}</p>
          <Select label={t('compare.other')} value={other} options={options} onChange={setOther} />
        </div>
      )}
    </Modal>
  );
}
