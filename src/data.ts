import { getStorageOwner, userStorageKey } from './auth/storage-owner';

export const photos = {
  portrait: 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=900&q=85',
  editorial: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=700&q=85',
  fashion: 'https://images.unsplash.com/photo-1483985988355-763728e1935b?auto=format&fit=crop&w=700&q=85',
  city: 'https://images.unsplash.com/photo-1519608487953-e999c86e7455?auto=format&fit=crop&w=800&q=85',
  studio: 'https://images.unsplash.com/photo-1490481651871-ab68de25d43d?auto=format&fit=crop&w=700&q=85',
  beach: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=700&q=85',
};

export const inspirations = [
  { title: 'Luz que transforma', category: 'Retrato editorial', image: photos.portrait, prompt: 'Retrato editorial com luz suave de fim de tarde, tons quentes e fundo desfocado. Preserve a identidade e a composição.' },
  { title: 'Seu próximo cenário', category: 'Lifestyle', image: photos.beach, prompt: 'Transforme o fundo em uma praia ao pôr do sol, com iluminação natural e tons dourados. Preserve o elemento principal.' },
  { title: 'Uma nova perspectiva', category: 'Moda & estilo', image: photos.studio, prompt: 'Crie uma composição de moda minimalista, com cores naturais, textura de tecido e luz de estúdio suave.' },
  { title: 'Depois das oito', category: 'Cinematográfico', image: photos.city, prompt: 'Cenário noturno cinematográfico com reflexos vermelhos, profundidade e atmosfera urbana. Preserve a composição.' },
  { title: 'Naturalmente você', category: 'Retrato natural', image: photos.editorial, prompt: 'Retrato natural com textura de pele preservada, luz lateral delicada e fundo discreto.' },
];

export function readLocal<T>(key: string, fallback: T): T {
  if (!getStorageOwner()) return fallback;
  try { const value = localStorage.getItem(userStorageKey(key)); return value ? JSON.parse(value) as T : fallback; } catch { return fallback; }
}
export function writeLocal(key: string, value: unknown): boolean {
  if (!getStorageOwner()) return false;
  try { localStorage.setItem(userStorageKey(key), JSON.stringify(value)); return true; } catch { return false; }
}
