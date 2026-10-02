export class AccessError extends Error {
  constructor(message: string, public readonly code = 'AUTH_ERROR') { super(message); this.name = 'AccessError'; }
}

export function authErrorMessage(error: unknown): string {
  if (error instanceof AccessError) return error.message;
  const candidate = error as { code?: string; message?: string; status?: number } | null;
  const code = candidate?.code || '';
  const message = (candidate?.message || '').toLowerCase();
  if (code === 'invalid_credentials' || message.includes('invalid login credentials')) return 'E-mail ou senha incorretos. Confira os dados e tente novamente.';
  if (['user_already_exists', 'email_exists'].includes(code) || message.includes('already registered')) return 'Este e-mail já tem uma conta. Use a opção Entrar.';
  if (code === 'weak_password' || message.includes('password should')) return 'Escolha uma senha com pelo menos 8 caracteres, evitando combinações comuns.';
  if (code === 'email_address_invalid' || code === 'validation_failed' || message.includes('invalid email')) return 'Informe um e-mail válido para continuar.';
  if (code === 'email_not_confirmed') return 'Não foi possível abrir sua conta. A configuração de acesso precisa ser revisada.';
  if (['over_request_rate_limit', 'over_email_send_rate_limit'].includes(code) || candidate?.status === 429) return 'Muitas tentativas em pouco tempo. Aguarde um minuto antes de tentar novamente.';
  if (['signup_disabled', 'email_provider_disabled'].includes(code)) return 'O cadastro está temporariamente indisponível. Tente novamente mais tarde.';
  if (['session_not_found', 'refresh_token_not_found', 'refresh_token_already_used', 'bad_jwt'].includes(code) || candidate?.status === 401 || candidate?.status === 403) return 'Sua sessão expirou. Entre novamente para continuar.';
  if (message.includes('fetch') || message.includes('network') || message.includes('timeout') || candidate?.status === 0 || (candidate?.status || 0) >= 500) return 'Não conseguimos conectar agora. Confira sua internet e tente novamente.';
  return 'Não foi possível concluir o acesso. Tente novamente em alguns instantes.';
}

export function validateCredentials(email: string, password: string, name?: string): void {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || email.trim().length > 254) throw new AccessError('Informe um e-mail válido para continuar.', 'INVALID_EMAIL');
  if (password.length < 8 || password.length > 128) throw new AccessError('Sua senha deve ter entre 8 e 128 caracteres.', 'INVALID_PASSWORD');
  if (name !== undefined && (name.trim().length < 2 || name.trim().length > 60)) throw new AccessError('Informe seu nome com 2 a 60 caracteres.', 'INVALID_NAME');
}
