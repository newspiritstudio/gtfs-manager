/**
 * Round flag of a country (ISO 3166-1 alpha-2 code). They come from circle-flags v2.8.0 (MIT), in
 * `public/flags/`; the catalog test checks there is one for every country.
 */
export default function CountryFlag({
  code,
  className = 'size-5',
}: {
  code: string;
  className?: string;
}) {
  return (
    <img
      src={`/flags/${code.toLowerCase()}.svg`}
      alt=""
      width={20}
      height={20}
      loading="lazy"
      className={`${className} shrink-0 rounded-full`}
    />
  );
}
