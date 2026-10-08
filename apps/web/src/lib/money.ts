/** Prices are in US dollars (Lulu quotes and Stripe charges in USD); outside the US the currency is spelled out. */
export function formatUsd(cents: number): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', currencyDisplay: 'narrowSymbol' }).format(cents / 100) + (navigator.language.startsWith('en-US') ? '' : ' USD');
}
