import { ImageResponse } from 'next/og';
import { SocialCard } from '@/server/brand-images';

export const alt = 'GTFS Manager';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OpenGraphImage() {
  return new ImageResponse(<SocialCard />, size);
}
