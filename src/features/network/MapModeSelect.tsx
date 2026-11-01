import { Layers } from 'lucide-react';
import Select from '@/components/ui/Select';
import { useI18n } from '@/lib/i18n/client';

export type MapMode = 'lines' | 'frequency' | 'coverage';

/** Switches the network map between its lines, the frequency of service and the stop coverage. */
export default function MapModeSelect({
  value,
  onChange,
}: {
  value: MapMode;
  onChange: (mode: MapMode) => void;
}) {
  const { t } = useI18n();
  return (
    <Select
      label={t('outputs.mapMode')}
      compactIcon={<Layers />}
      value={value}
      onChange={(v) => onChange(v as MapMode)}
      options={(['lines', 'frequency', 'coverage'] as const).map((m) => ({
        value: m,
        label: t(`outputs.mode.${m}`),
      }))}
    />
  );
}
