import {
  Bus,
  CableCar,
  Ship,
  TrainFront,
  TrainFrontTunnel,
  TramFront,
  type LucideIcon,
} from 'lucide-react';
import type { TransitMode } from '@shared/gtfs-spec';

/** The icon of each transport mode (route_type), the same across the app. */
const MODE_ICONS: Record<TransitMode, LucideIcon> = {
  tram: TramFront,
  subway: TrainFrontTunnel,
  rail: TrainFront,
  bus: Bus,
  ferry: Ship,
  cableTram: TramFront,
  aerial: CableCar,
  funicular: CableCar,
  trolleybus: Bus,
  monorail: TrainFront,
  other: TrainFront,
};

export default function ModeIcon({ mode, className }: { mode: TransitMode; className?: string }) {
  const Icon = MODE_ICONS[mode];
  return <Icon aria-hidden className={className} />;
}
