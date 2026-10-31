import HomePage, { generateMetadata as homeMetadata } from '../page';
import { assertLocale } from './locale-route';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props) {
  await assertLocale(params);
  return homeMetadata();
}

export default async function LocalizedHome({ params }: Props) {
  await assertLocale(params);
  return <HomePage />;
}
