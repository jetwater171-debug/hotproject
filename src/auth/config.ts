export interface AuthConfiguration { url: string; key: string; configured: boolean; error: string | null }

/** Validate public configuration without returning/logging the supplied key in errors. */
export function readAuthConfiguration(environment: Record<string, unknown>): AuthConfiguration {
  const url = typeof environment.VITE_SUPABASE_URL === 'string' ? environment.VITE_SUPABASE_URL.trim() : '';
  const key = typeof environment.VITE_SUPABASE_ANON_KEY === 'string' ? environment.VITE_SUPABASE_ANON_KEY.trim() : '';
  const invalid = (error: string): AuthConfiguration => ({ url: '', key: '', configured: false, error });
  if (!url || !key) return invalid('O acesso está sendo configurado. Tente novamente em alguns instantes.');
  try {
    const endpoint = new URL(url);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname);
    if ((endpoint.protocol !== 'https:' && !(local && endpoint.protocol === 'http:')) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) return invalid('A configuração de acesso precisa ser revisada.');
  } catch { return invalid('A configuração de acesso precisa ser revisada.'); }
  if (key.startsWith('sb_secret_')) return invalid('A configuração de acesso precisa usar uma chave pública.');
  if (!key.startsWith('sb_publishable_')) {
    try {
      const encoded = key.split('.')[1];
      const decoded = JSON.parse(atob(encoded.replace(/-/g, '+').replace(/_/g, '/')));
      if (decoded.role !== 'anon') return invalid('A configuração de acesso precisa usar uma chave pública.');
    } catch { return invalid('A configuração de acesso precisa ser revisada.'); }
  }
  return { url: url.replace(/\/$/, ''), key, configured: true, error: null };
}
