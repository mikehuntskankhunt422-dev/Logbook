/**
 * Countries Lulu ships to: those of Stripe's Checkout countries for which the Lulu sandbox's
 * `/shipping-options/` offered at least one option for a 100-page 6 × 9 in premium-colour paperback
 * on 2026-10-08. Written by `npm run lulu:countries -w @logbook/server`
 * (apps/server/scripts/refresh-lulu-countries.ts); don't edit by hand.
 */
export const LULU_COUNTRIES: readonly string[] = [
  'AD', 'AE', 'AG', 'AI', 'AL', 'AM', 'AO', 'AQ', 'AR', 'AT', 'AU', 'AW', 'AX', 'AZ', 'BA', 'BB',
  'BD', 'BE', 'BF', 'BG', 'BH', 'BI', 'BJ', 'BL', 'BM', 'BN', 'BO', 'BQ', 'BR', 'BS', 'BT', 'BV',
  'BW', 'BZ', 'CA', 'CD', 'CG', 'CH', 'CI', 'CK', 'CL', 'CM', 'CN', 'CO', 'CR', 'CV', 'CW', 'CY',
  'CZ', 'DE', 'DJ', 'DK', 'DM', 'DO', 'DZ', 'EC', 'EE', 'EG', 'ER', 'ES', 'ET', 'FI', 'FJ', 'FO',
  'FR', 'GA', 'GB', 'GD', 'GE', 'GF', 'GG', 'GH', 'GI', 'GL', 'GM', 'GN', 'GP', 'GR', 'GS', 'GT',
  'GU', 'GY', 'HK', 'HN', 'HR', 'HT', 'HU', 'ID', 'IE', 'IL', 'IM', 'IN', 'IO', 'IQ', 'IS', 'IT',
  'JE', 'JM', 'JO', 'JP', 'KE', 'KG', 'KH', 'KN', 'KR', 'KW', 'KY', 'KZ', 'LA', 'LB', 'LC', 'LI',
  'LK', 'LR', 'LS', 'LT', 'LU', 'LV', 'LY', 'MA', 'MC', 'MD', 'ME', 'MF', 'MG', 'MK', 'ML', 'MN',
  'MO', 'MQ', 'MR', 'MS', 'MT', 'MU', 'MV', 'MW', 'MX', 'MY', 'MZ', 'NA', 'NC', 'NE', 'NG', 'NI',
  'NL', 'NO', 'NP', 'NZ', 'OM', 'PA', 'PE', 'PF', 'PG', 'PH', 'PK', 'PL', 'PN', 'PR', 'PS', 'PT',
  'PY', 'QA', 'RE', 'RO', 'RS', 'RW', 'SA', 'SC', 'SE', 'SG', 'SI', 'SJ', 'SK', 'SM', 'SN', 'SR',
  'SV', 'SX', 'SZ', 'TC', 'TD', 'TF', 'TG', 'TH', 'TL', 'TN', 'TO', 'TR', 'TT', 'TW', 'TZ', 'UG',
  'US', 'UY', 'UZ', 'VA', 'VC', 'VG', 'VN', 'VU', 'WF', 'WS', 'YT', 'ZA', 'ZM', 'ZW',
];

/** Where Lulu answered 400 (no shipping) on 2026-10-08. */
export const LULU_NO_SHIPPING: readonly string[] = [
  'AC', 'AF', 'BY', 'CF', 'EH', 'FK', 'GQ', 'GW', 'KI', 'KM', 'MM', 'NR', 'NU', 'PM', 'RU', 'SB',
  'SD', 'SH', 'SL', 'SO', 'SS', 'ST', 'TA', 'TJ', 'TK', 'TM', 'TV', 'UA', 'VE', 'XK', 'YE',
];
