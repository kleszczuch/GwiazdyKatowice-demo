// Aplikacja natywna wraca z logowania przez własny schemat URL (deep link),
// przeglądarka na ten sam adres, z którego zaczęła.
export function authRedirectTo(
  location: Pick<URL, 'origin' | 'pathname'>,
  nativeApp: boolean,
) {
  return nativeApp
    ? 'gwiazdykatowice://auth/callback'
    : new URL(location.pathname, location.origin).toString();
}

export function isEmailLinkError(location: URL) {
  const fragment = new URLSearchParams(location.hash.slice(1));
  return [location.searchParams, fragment].some(
    (params) => params.get('error_code') === 'otp_expired',
  );
}

// Jeśli po starcie w adresie nadal jest ?code=, biblioteka Supabase go nie
// wymieniła na sesję. Zwraca adres bez kodu, żeby odświeżenie strony nie
// próbowało użyć go ponownie; null oznacza, że kodu nie było.
export function unusedAuthCodePath(location: URL) {
  if (!location.searchParams.has('code')) return null;
  const cleaned = new URL(location.toString());
  cleaned.searchParams.delete('code');
  return `${cleaned.pathname}${cleaned.search}${cleaned.hash}`;
}

// Rozpoznaje nieudany powrót z logowania i czyści adres. Portal używa
// wyłącznie PKCE, więc tokeny w adresie (przepływ implicit) też są błędem:
// usuwamy je z query i fragmentu, żeby nie zostały w historii przeglądarki.
export function readAuthCallbackError(location: URL) {
  const cleaned = new URL(location.toString());
  const fragment = new URLSearchParams(cleaned.hash.slice(1));
  const errorKeys = ['error', 'error_description', 'error_code'];
  const tokenKeys = [
    'access_token',
    'refresh_token',
    'provider_token',
    'provider_refresh_token',
  ];
  const implicit = tokenKeys.some(
    (key) => cleaned.searchParams.has(key) || fragment.has(key),
  );
  const queryError = errorKeys.some((key) => cleaned.searchParams.has(key));
  const fragmentError = errorKeys.some((key) => fragment.has(key));
  if (queryError) for (const key of errorKeys) cleaned.searchParams.delete(key);
  if (implicit) {
    for (const key of [
      ...tokenKeys,
      'expires_at',
      'expires_in',
      'token_type',
      'sb',
    ]) {
      if (cleaned.searchParams.has(key)) cleaned.searchParams.delete(key);
      fragment.delete(key);
    }
  }
  if (fragmentError || implicit) {
    for (const key of errorKeys) fragment.delete(key);
    cleaned.hash = fragment.toString();
  }
  return {
    hasError: queryError || fragmentError || implicit,
    cleanedPath: `${cleaned.pathname}${cleaned.search}${cleaned.hash}`,
  };
}
