// Dzisiejsza data (RRRR-MM-DD) w strefie klubu, niezależnie od strefy urządzenia.
// Locale sv-SE daje format ISO, który można porównywać jak tekst.
export const warsawDay = (date: Date) =>
  new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Warsaw',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
export const warsawToday = () => warsawDay(new Date());

// Niepełnoletni = 18. urodziny przypadają po dacie `today`. Porównujemy same
// daty jako tekst, bez godzin i stref. Nieprawidłowa data daje false.
export const isMinor = (birth: string, today = warsawToday()) => {
  const adulthood = new Date(`${birth}T12:00:00Z`);
  if (Number.isNaN(adulthood.getTime())) return false;
  adulthood.setUTCFullYear(adulthood.getUTCFullYear() + 18);
  return adulthood.toISOString().slice(0, 10) > today;
};
