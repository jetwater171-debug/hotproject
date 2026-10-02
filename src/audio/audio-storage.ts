import { getStorageOwner } from '../auth/storage-owner';
const DATABASE = 'velora-audio-files';
const STORE = 'files';
const MAX_FILE_BYTES = 64 * 1024 * 1024;
let databasePromise: Promise<IDBDatabase> | null = null;

function storageError(error?: DOMException | null): Error {
  if (error?.name === 'QuotaExceededError') return new Error('O armazenamento local está cheio. Baixe o áudio e libere espaço antes de salvar.');
  if (error?.name === 'SecurityError' || error?.name === 'InvalidStateError') return new Error('O navegador bloqueou o armazenamento de áudio. Permita dados locais para este site.');
  return new Error('Não foi possível acessar o áudio salvo neste navegador. Tente novamente após liberar espaço.');
}

function checkId(id: string): void {
  if (typeof id !== 'string' || !id.trim() || id.length > 200) throw new Error('A referência deste áudio é inválida.');
}
function ownerId(): string {
  const owner=getStorageOwner();
  if(!owner)throw new Error('Entre na sua conta para acessar os arquivos salvos.');
  return owner;
}
const recordId=(owner:string,id:string)=>`${owner}:${id}`;

async function database(): Promise<IDBDatabase> {
  if (!globalThis.indexedDB) throw new Error('Este navegador não oferece armazenamento local de áudio. Baixe o arquivo para guardá-lo.');
  if (databasePromise) return databasePromise;
  databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
    let request: IDBOpenDBRequest;
    let abandoned = false;
    try { request = indexedDB.open(DATABASE, 1); }
    catch (error) { reject(storageError(error instanceof DOMException ? error : null)); return; }
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: 'id' });
    };
    request.onerror = () => { abandoned = true; reject(storageError(request.error)); };
    request.onblocked = () => { abandoned = true; reject(new Error('Outra aba está usando o armazenamento de áudio. Feche essa aba e tente novamente.')); };
    request.onsuccess = () => {
      const connection = request.result;
      if (abandoned) { connection.close(); return; }
      connection.onversionchange = () => { connection.close(); databasePromise = null; };
      connection.onclose = () => { databasePromise = null; };
      resolve(connection);
    };
  }).catch(error => { databasePromise = null; throw error; });
  return databasePromise;
}

/** Store binaries in IndexedDB; localStorage holds metadata only. */
export async function saveAudioFile(id: string, blob: Blob): Promise<void> {
  return saveAudioFiles([{id,blob}]);
}

/** A project and its stems are written in one transaction, including guide/IR blobs. */
export async function saveAudioFiles(files: Array<{id:string;blob:Blob}>): Promise<void> {
  if(!files.length)return;
  const owner=ownerId();
  const ids=new Set<string>();
  for(const {id,blob} of files){checkId(id);if(ids.has(id))throw new Error('O projeto contém referências de áudio repetidas.');ids.add(id);if(!(blob instanceof Blob)||!blob.size)throw new Error('O arquivo de áudio está vazio.');if(blob.size>MAX_FILE_BYTES)throw new Error('O áudio exportado excede o limite local de 64 MB. Use um trecho menor.');}
  const connection = await database();
  return new Promise((resolve, reject) => {
    let transaction: IDBTransaction | undefined;
    try {
      transaction = connection.transaction(STORE, 'readwrite');
      const store=transaction.objectStore(STORE),createdAt=Date.now();
      for(const {id,blob} of files)store.put({ id:recordId(owner,id), blob, createdAt });
    } catch (error) { transaction?.abort();reject(storageError(error instanceof DOMException ? error : null)); return; }
    const committed=transaction;
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(storageError(committed.error));
    transaction.onabort = () => reject(storageError(committed.error));
  });
}

export async function getAudioFile(id: string): Promise<Blob | null> {
  checkId(id);
  const owner=ownerId();
  const connection = await database();
  return new Promise((resolve, reject) => {
    let transaction: IDBTransaction;
    let record: unknown;
    try {
      transaction = connection.transaction(STORE, 'readonly');
      const request = transaction.objectStore(STORE).get(recordId(owner,id));
      request.onsuccess = () => { record = request.result; };
    } catch (error) { reject(storageError(error instanceof DOMException ? error : null)); return; }
    transaction.oncomplete = () => {
      const value = record as { blob?: unknown } | undefined;
      resolve(value?.blob instanceof Blob ? value.blob : null);
    };
    transaction.onerror = () => reject(storageError(transaction.error));
    transaction.onabort = () => reject(storageError(transaction.error));
  });
}

export async function deleteAudioFile(id: string, capturedOwner?:string): Promise<void> {
  checkId(id);
  const owner=capturedOwner||ownerId();
  if(!/^[a-zA-Z0-9_-]{1,128}$/.test(owner))throw new Error('A conta do arquivo é inválida.');
  const connection = await database();
  return new Promise((resolve, reject) => {
    let transaction: IDBTransaction;
    try { transaction = connection.transaction(STORE, 'readwrite'); transaction.objectStore(STORE).delete(recordId(owner,id)); }
    catch (error) { reject(storageError(error instanceof DOMException ? error : null)); return; }
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(storageError(transaction.error));
    transaction.onabort = () => reject(storageError(transaction.error));
  });
}
