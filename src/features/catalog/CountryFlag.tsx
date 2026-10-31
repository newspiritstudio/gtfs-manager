/**
 * Bandera rodona d'un país (codi ISO 3166-1 alfa-2). Són de circle-flags v2.8.0 (MIT), a
 * `public/flags/`; el test del catàleg comprova que n'hi ha una per a cada país.
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
