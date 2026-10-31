import { ImageResponse } from 'next/og';
import { APPLE_ICON_SVG, svgDataUri } from '@/server/brand-images';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  return new ImageResponse(
    <img src={svgDataUri(APPLE_ICON_SVG)} width={180} height={180} alt="" />,
    size
  );
}
