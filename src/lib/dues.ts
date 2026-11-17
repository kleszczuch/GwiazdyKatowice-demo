// Zamienia wpisaną kwotę (z przecinkiem lub kropką) na grosze bez arytmetyki
// zmiennoprzecinkowej. Saldo to zaległość, więc poprawna jest tylko wartość
// <= 0 mieszcząca się w kolumnie integer bazy.
export function parseDues(value: string): number | null {
  const normalized = value.trim().replace(',', '.');
  if (!/^-?\d+(\.\d{1,2})?$/.test(normalized)) return null;
  const [whole, fraction = ''] = normalized.replace('-', '').split('.');
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  const signed = normalized.startsWith('-') ? -amount : amount;
  return Number.isSafeInteger(signed) && signed <= 0 && signed >= -2147483648
    ? signed
    : null;
}
export const formatDues = (grosze: number, language: 'pl' | 'en') =>
  new Intl.NumberFormat(language === 'pl' ? 'pl-PL' : 'en-GB', {
    style: 'currency',
    currency: 'PLN',
    maximumFractionDigits: 2,
    minimumFractionDigits: grosze % 100 === 0 ? 0 : 2,
  }).format(grosze / 100);
