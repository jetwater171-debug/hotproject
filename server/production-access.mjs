import { randomUUID } from 'node:crypto';

export class AccessError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const deny = (status, code, message) => { throw new AccessError(status, code, message); };
const integer = (value, fallback, min, max) => value === undefined || value === '' ? fallback : /^\d+$/.test(String(value)) && Number(value) >= min && Number(value) <= max ? Number(value) : null;
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);

function serviceUrl(value) {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash ? url.origin : null; } catch { return null; }
}

function origins(env) {
  const result = new Set();
  const values = [env.APP_ORIGINS, ...[env.VERCEL_URL, env.VERCEL_PROJECT_PRODUCTION_URL].filter(Boolean).map(value => `https://${value}`)].filter(Boolean).flatMap(value => String(value).split(','));
  for (const value of values) {
    try { const url = new URL(value.trim()); if (url.protocol === 'https:' && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash) result.add(url.origin); } catch { /* Invalid values grant no access. */ }
  }
  return result;
}

/** Supabase Auth verifies the bearer token; decoded client claims never authorize a request. */
export function createProductionAccess({ env = process.env, fetchImpl = globalThis.fetch, production = env.VERCEL === '1' } = {}) {
  const required = production || env.AUDIO_REQUIRE_AUTH === 'true' || Boolean(env.SUPABASE_URL && env.SUPABASE_ANON_KEY);
  const base = serviceUrl(env.SUPABASE_URL), anon = typeof env.SUPABASE_ANON_KEY === 'string' ? env.SUPABASE_ANON_KEY.trim() : '', service = typeof env.SUPABASE_SERVICE_ROLE_KEY === 'string' ? env.SUPABASE_SERVICE_ROLE_KEY.trim() : '';
  const allowed = origins(env);
  const limits = { daily: integer(env.AUDIO_DAILY_LIMIT, 10, 1, 1000), units: integer(env.AUDIO_DAILY_UNITS, 15000, 1, 1000000), globalDaily: integer(env.AUDIO_GLOBAL_DAILY_LIMIT, 50, 1, 10000), globalUnits: integer(env.AUDIO_GLOBAL_DAILY_UNITS, 75000, 1, 10000000), concurrency: 2, leaseSeconds: 150 };
  const configured = Boolean(base && anon), usageConfigured = Boolean(base && service && Object.values(limits).every(Number.isInteger));

  const request = async (path, options, failureCode, failureMessage) => {
    try { return await fetchImpl(base + path, { ...options, signal: AbortSignal.timeout(8000), redirect: 'error' }); }
    catch { deny(503, failureCode, failureMessage); }
  };
  const rpc = async (name, body) => {
    if (!usageConfigured) deny(503, 'usage_unavailable', 'A proteção de consumo ainda não está configurada. Nenhuma geração foi solicitada.');
    const response = await request(`/rest/v1/rpc/${name}`, { method: 'POST', headers: { apikey: service, Authorization: `Bearer ${service}`, 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) }, 'usage_unavailable', 'Não foi possível verificar o limite de consumo. Nenhuma geração foi solicitada.');
    if (!response.ok) deny(503, 'usage_unavailable', 'Não foi possível verificar o limite de consumo. Confira a configuração e a migração do banco.');
    try { return await response.json(); } catch { deny(503, 'usage_unavailable', 'O banco não devolveu uma confirmação válida do limite de consumo.'); }
  };

  return {
    required, production, configured, usageConfigured, limits,
    requireOrigin(req, res) {
      if (!production) return;
      if (!allowed.size) deny(503, 'origin_not_configured', 'O domínio desta API ainda não foi configurado.');
      const host = typeof req.headers.host === 'string' ? `https://${req.headers.host}` : '';
      if (!allowed.has(host)) deny(403, 'foreign_host', 'Este domínio não é permitido para a API.');
      const origin = req.headers.origin;
      if (origin && (typeof origin !== 'string' || !allowed.has(origin))) deny(403, 'foreign_origin', 'A origem desta solicitação não é permitida.');
      if (req.headers['sec-fetch-site'] === 'cross-site' && !origin) deny(403, 'foreign_origin', 'A origem desta solicitação não é permitida.');
      if (origin) {
        res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type'); res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Expose-Headers', 'X-Voice-Model, X-Guide-Duration, X-Speech-Format, X-Speech-Container, X-Speech-Sample-Rate, X-Speech-Bit-Depth, X-Ambience-Source, X-Ambience-Reviewed, X-Ambience-Revision, X-Ambience-Provenance, X-Audio-Resource-Metadata');
      }
    },
    async authenticate(req) {
      if (!required) return null;
      if (!configured) deny(503, 'auth_not_configured', 'A autenticação da API ainda não está configurada.');
      const authorization = req.headers.authorization;
      if (typeof authorization !== 'string' || !/^Bearer [A-Za-z0-9_.-]{20,8192}$/.test(authorization)) deny(401, 'auth_required', 'Entre na sua conta para usar o estúdio de áudio.');
      const response = await request('/auth/v1/user', { method: 'GET', headers: { apikey: anon, Authorization: authorization, Accept: 'application/json' } }, 'auth_unavailable', 'Não foi possível verificar sua sessão. Tente novamente.');
      if (response.status === 401 || response.status === 403) deny(401, 'auth_invalid', 'Sua sessão expirou ou não é válida. Entre novamente.');
      if (!response.ok) deny(503, 'auth_unavailable', 'Não foi possível verificar sua sessão. Tente novamente.');
      let user;
      try { user = await response.json(); } catch { deny(503, 'auth_unavailable', 'Não foi possível verificar sua sessão. Tente novamente.'); }
      if (!uuid(user?.id) || user.is_anonymous === true || user.banned_until && Date.parse(user.banned_until) > Date.now()) deny(401, 'auth_invalid', 'Entre com uma conta ativa para usar o estúdio.');
      return { id: user.id };
    },
    async reserve(userId, operation, units) {
      if (!required) return null;
      if (!uuid(userId) || !['speech', 'voice_change', 'ambience'].includes(operation) || !Number.isInteger(units) || units < 1 || units > 10000) deny(503, 'usage_unavailable', 'Não foi possível verificar esta operação.');
      const requestId = randomUUID();
      const result = await rpc('reserve_audio_usage', { p_user_id: userId, p_request_id: requestId, p_operation: operation, p_units: units, p_daily_limit: limits.daily, p_daily_units: limits.units, p_global_daily_limit: limits.globalDaily, p_global_daily_units: limits.globalUnits, p_concurrency: limits.concurrency, p_lease_seconds: limits.leaseSeconds });
      if (result?.allowed !== true) {
        const messages = { daily_limit: 'Você chegou ao limite diário de gerações. Tente novamente amanhã.', daily_budget_limit: 'Você chegou ao limite diário de processamento de áudio.', global_daily_limit: 'O limite de gerações do estúdio foi atingido hoje. Tente novamente amanhã.', global_budget_limit: 'O limite diário de processamento do estúdio foi atingido.', concurrency_limit: 'Já existem duas gerações em andamento. Aguarde a conclusão.' };
        if (Object.hasOwn(messages, result?.code)) deny(429, result.code, messages[result.code]);
        deny(503, 'usage_unavailable', 'O banco não autorizou a geração. Nenhuma chamada ao provedor foi feita.');
      }
      if (result.requestId !== requestId) deny(503, 'usage_unavailable', 'O banco não confirmou a reserva desta geração.');
      return { requestId, userId };
    },
    async finish(lease, outcome) {
      if (!lease) return;
      await rpc('finish_audio_usage', { p_user_id: lease.userId, p_request_id: lease.requestId, p_outcome: ['succeeded', 'failed', 'timeout'].includes(outcome) ? outcome : 'failed' });
    },
  };
}
