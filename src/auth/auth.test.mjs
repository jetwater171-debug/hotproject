import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

// Pure validation and SDK contract tests. There is no network, account creation
// or auth bypass in the application; all fixtures exist only in this test VM.
function fixture(env = {}) {
  const storage = new Map(), calls = [];
  const session = { access_token: 'test-session-token', user: { id: 'user-a', email: 'test@example.invalid', user_metadata: { display_name: 'Pessoa Teste' } } };
  const replies = { session, user: session.user, error: null, signupSession: session };
  const sdk = { auth: {
    getSession: async () => ({ data: { session: replies.session }, error: replies.error }),
    getUser: async token => { calls.push({ method: 'getUser', token }); return { data: { user: replies.user }, error: replies.error }; },
    signInWithPassword: async input => { calls.push({ method: 'signIn', input }); return { data: { session: replies.session }, error: replies.error }; },
    signUp: async input => { calls.push({ method: 'signUp', input }); return { data: { session: replies.signupSession, user: replies.user }, error: replies.error }; },
    signOut: async input => { calls.push({ method: 'signOut', input }); return { error: replies.error }; },
    updateUser: async input => { calls.push({ method: 'updateUser', input }); return { data: { user: replies.user }, error: replies.error }; },
  } };
  const modules = new Map();
  function load(name) {
    if (modules.has(name)) return modules.get(name);
    const exports = {}; modules.set(name, exports);
    const source = fs.readFileSync(new URL(`./${name}.ts`, import.meta.url), 'utf8');
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText.replaceAll('import.meta', '__fixtureMeta');
    vm.runInNewContext(compiled, {
      exports, URL, atob, __fixtureMeta: { env },
      localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
      require: path => path === '@supabase/supabase-js' ? { createClient: (...arguments_) => { calls.push({ method: 'createClient', arguments_ }); return sdk; } } : load(path.replace('./', '')),
    });
    return exports;
  }
  return { load, storage, calls, replies, session };
}
const publicEnv = { VITE_SUPABASE_URL: 'https://auth-test.example.invalid', VITE_SUPABASE_ANON_KEY: 'sb_publishable_test_fixture' };

test('frontend configuration refuses secrets and legacy service-role keys without exposing them', () => {
  const { readAuthConfiguration } = fixture().load('config');
  const fakeJwt = role => `header.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.signature`;
  const privateKey = 'sb_secret_TEST_DO_NOT_USE';
  for (const key of [privateKey, fakeJwt('service_role'), fakeJwt('authenticated')]) {
    const result = readAuthConfiguration({ ...publicEnv, VITE_SUPABASE_ANON_KEY: key });
    assert.equal(result.configured, false);
    assert.equal(result.key, '');
    assert.ok(!result.error.includes(key));
  }
  assert.equal(readAuthConfiguration(publicEnv).configured, true);
  assert.equal(readAuthConfiguration({ ...publicEnv, VITE_SUPABASE_ANON_KEY: fakeJwt('anon') }).configured, true);
  assert.equal(readAuthConfiguration({ ...publicEnv, VITE_SUPABASE_URL: 'http://remote.example.invalid' }).configured, false);
  assert.equal(readAuthConfiguration({ ...publicEnv, VITE_SUPABASE_URL: 'https://user:secret@example.invalid' }).configured, false);
  assert.equal(readAuthConfiguration({ ...publicEnv, VITE_SUPABASE_URL: 'http://127.0.0.1:54321' }).configured, true);
});

test('missing auth configuration cannot create a client or a session', async () => {
  const state = fixture(), service = state.load('service');
  assert.equal(service.getSupabaseClient(), null);
  assert.equal(await service.getAccessToken(), null);
  await assert.rejects(() => service.signIn('test@example.invalid', 'fixture-password'), /configurado/);
  assert.equal(state.calls.length, 0);
});

test('local ownership is per-user and cannot be switched by another tab changing the marker', () => {
  const state = fixture(), owner = state.load('storage-owner');
  assert.throws(() => owner.userStorageKey('velora-assets'), /Entre na sua conta/);
  owner.setStorageOwner('user-a');
  const a = owner.userStorageKey('velora-assets');
  state.storage.set('velora:active-owner', 'user-b');
  assert.equal(owner.getStorageOwner(), 'user-a');
  assert.equal(owner.userStorageKey('velora-assets'), a);
  owner.setStorageOwner('user-b');
  assert.notEqual(owner.userStorageKey('velora-assets'), a);
  assert.equal(owner.userStorageKey('velora-assets', 'user-a'), a, 'Explicit captured ownership remains stable for an already-started operation.');
  owner.setStorageOwner(null);
  assert.equal(owner.getStorageOwner(), null);
  assert.equal(state.storage.has('velora:active-owner'), false);
  assert.throws(() => owner.userStorageKey('velora-assets'), /Entre na sua conta/);
  assert.throws(() => owner.setStorageOwner('../user-b'), /usuário válido/);
});

test('all workspace routes are protected and public/unknown routes do not imply access', () => {
  const routes = fixture().load('routes');
  for (const route of ['home', 'images', 'audio', 'library', 'profiles', 'plans', 'settings']) {
    assert.equal(routes.resolveAppRoute({ hash: `#/${route}`, pathname: '/' }), route);
    assert.equal(routes.isWorkspaceRoute(route), true);
  }
  for (const hash of ['', '#/', '#/landing', '#/not-a-route', '#/https://untrusted.example']) assert.equal(routes.resolveAppRoute({ hash, pathname: '/' }), 'landing');
  assert.equal(routes.resolveAppRoute({ hash: '', pathname: '/landing' }), 'landing');
  assert.equal(routes.resolveAppRoute({ hash: '#/welcome', pathname: '/' }), 'login');
  assert.equal(routes.resolveAppRoute({ hash: '#/signup', pathname: '/' }), 'signup');
  assert.equal(routes.isWorkspaceRoute('login'), false);
});

test('credential validation rejects missing/short credentials before reaching the SDK', async () => {
  const state = fixture(publicEnv), service = state.load('service');
  await assert.rejects(() => service.signIn('invalid-email', 'fixture-password'), /e-mail válido/);
  await assert.rejects(() => service.signIn('test@example.invalid', 'short'), /8 e 128/);
  await assert.rejects(() => service.signUp(' ', 'test@example.invalid', 'fixture-password'), /nome com 2/);
  assert.equal(state.calls.length, 0);
});

test('signup uses Supabase and requires a returned session instead of opening demo access', async () => {
  const state = fixture(publicEnv), service = state.load('service');
  const returned = await service.signUp(' Pessoa Teste ', ' TEST@example.invalid ', '  fixture-password  ');
  assert.equal(returned, state.session);
  const request = state.calls.find(call => call.method === 'signUp').input;
  assert.equal(request.email, 'test@example.invalid');
  assert.equal(request.password, '  fixture-password  ', 'Passwords must not be trimmed silently.');
  assert.equal(request.options.data.display_name, 'Pessoa Teste');
  state.replies.signupSession = null;
  await assert.rejects(() => service.signUp('Pessoa Teste', 'test@example.invalid', 'fixture-password'), /configuração de acesso/);
  const clientConfiguration = state.calls.find(call => call.method === 'createClient').arguments_[2];
  assert.equal(clientConfiguration.auth.flowType, 'implicit', 'Autoconfirm must not use a PKCE signup flow.');
  assert.equal(clientConfiguration.auth.persistSession, true);
});

test('token retrieval reads the current SDK session and restoration verifies user identity', async () => {
  const state = fixture(publicEnv), service = state.load('service');
  assert.equal(await service.getAccessToken(), 'test-session-token');
  state.replies.session = { ...state.session, access_token: 'test-refreshed-token' };
  assert.equal(await service.getAccessToken(), 'test-refreshed-token');
  const confirmed = await service.verifyAuthSession(state.replies.session);
  assert.equal(confirmed.user.id, 'user-a');
  assert.equal(state.calls.find(call => call.method === 'getUser').token, 'test-refreshed-token');
  state.replies.user = { ...state.session.user, id: 'user-b' };
  await assert.rejects(() => service.verifyAuthSession(state.session), /sessão expirou/);
  state.replies.session = null;
  assert.equal(await service.getAccessToken(), null);
});

test('logout uses the SDK local scope and profile updates change real user metadata', async () => {
  const state = fixture(publicEnv), service = state.load('service');
  await service.signOut();
  assert.equal(state.calls.find(call => call.method === 'signOut').input.scope, 'local');
  await service.updateDisplayName(' Novo Nome ');
  assert.equal(state.calls.find(call => call.method === 'updateUser').input.data.display_name, 'Novo Nome');
  await assert.rejects(() => service.updateDisplayName('x'), /nome com 2/);
  assert.equal(service.getUserDisplayName(state.session.user), 'Pessoa Teste');
});

test('anonymous/guest sessions cannot provide paid API tokens or restore a workspace account', async () => {
  const state = fixture(publicEnv), service = state.load('service');
  state.replies.session = { ...state.session, user: { ...state.session.user, is_anonymous: true } };
  state.replies.user = state.replies.session.user;
  assert.equal(await service.getAccessToken(), null);
  await assert.rejects(() => service.verifyAuthSession(state.replies.session), /Entre com sua conta/);
});
