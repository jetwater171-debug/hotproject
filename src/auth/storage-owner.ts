/** In-memory ownership is deliberately separate from the persisted marker.
 * Another browser tab must not redirect this tab's file writes to its user. */
let activeOwner: string | null = null;
const MARKER = 'velora:active-owner';

export function setStorageOwner(userId: string | null): void {
  if (userId !== null && !/^[a-zA-Z0-9_-]{1,128}$/.test(userId)) throw new Error('A sessão não contém um usuário válido. Entre novamente.');
  activeOwner = userId;
  try {
    if (userId) localStorage.setItem(MARKER, userId);
    else localStorage.removeItem(MARKER);
  } catch { /* Ownership still works if the browser refuses the optional marker. */ }
}

export function getStorageOwner(): string | null { return activeOwner; }

export function requireStorageOwner(): string {
  if (!activeOwner) throw new Error('Entre na sua conta para acessar seus arquivos.');
  return activeOwner;
}

/** No migration/fallback to legacy anonymous data belonging to an unknown user. */
export function userStorageKey(key: string, owner = requireStorageOwner()): string {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(owner) || !key || key.length > 300) throw new Error('A referência do armazenamento é inválida.');
  return `velora:user:${owner}:${key}`;
}
