export type WorkspaceRoute = 'home' | 'images' | 'audio' | 'library' | 'profiles' | 'plans' | 'settings';
export type AppRoute = WorkspaceRoute | 'landing' | 'login' | 'signup';
const protectedRoutes: readonly string[] = ['home', 'images', 'audio', 'library', 'profiles', 'plans', 'settings'];

export function isWorkspaceRoute(route: string): route is WorkspaceRoute { return protectedRoutes.includes(route); }

export function resolveAppRoute(location: Pick<Location, 'hash' | 'pathname'>): AppRoute {
  const path = location.hash ? location.hash.replace(/^#\/?/, '') : location.pathname.replace(/^\//, '');
  const page = path.split(/[?#]/)[0].replace(/\/$/, '');
  if (isWorkspaceRoute(page)) return page;
  if (page === 'signup') return 'signup';
  if (page === 'login' || page === 'welcome') return 'login';
  return 'landing';
}
