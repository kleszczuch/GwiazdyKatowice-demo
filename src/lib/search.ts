// Wyszukiwanie po nazwie bez rozróżniania wielkości liter i polskich znaków:
// NFD rozbija literę na znak bazowy i akcent, który usuwamy; „ł” nie ma
// rozkładu w Unicode, więc jest zamieniane osobno.
const normalize = (value: string) =>
  value
    .toLocaleLowerCase('pl')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ł/g, 'l');

// Każde słowo zapytania musi wystąpić w nazwie; kolejność słów jest dowolna.
export function matchesNameSearch(name: string, search: string) {
  const normalizedName = normalize(name);
  return normalize(search)
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => normalizedName.includes(term));
}
