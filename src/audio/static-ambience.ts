export interface StaticAmbienceMetadata {publicUrl:string;mimeType:string;source:'recording';reviewed:false;revision:string;provenance?:{label:string;source:string;license:string;licenseUrl?:string}}
const error=()=>new Error('A gravação do ambiente não pôde ser validada. Atualize a biblioteca e tente novamente.');
/** Only licensed, public, immutable bundle assets use the CDN; no auth token leaves the API. */
export function validateStaticAmbience(value:unknown):StaticAmbienceMetadata {
  if(!value||typeof value!=='object')throw error();const m=value as StaticAmbienceMetadata;
  if(!/^\/audio\/ambiences\/[a-z0-9_-]+\.(flac|wav|mp3|ogg)$/.test(m.publicUrl||'')||!['audio/flac','audio/wav','audio/mpeg','audio/ogg'].includes(m.mimeType)||m.source!=='recording'||m.reviewed!==false||!/^[a-f0-9]{64}$/.test(m.revision||''))throw error();
  if(m.provenance&&(typeof m.provenance.label!=='string'||typeof m.provenance.source!=='string'||typeof m.provenance.license!=='string'))throw error();
  return {publicUrl:m.publicUrl,mimeType:m.mimeType,source:'recording',reviewed:false,revision:m.revision,...(m.provenance?{provenance:m.provenance}:{})};
}
export async function downloadStaticAmbience(value:unknown,signal?:AbortSignal,fetcher:typeof fetch=fetch):Promise<{blob:Blob;source:'recording';reviewed:false;revision:string;provenance?:StaticAmbienceMetadata['provenance']}> {
  const metadata=validateStaticAmbience(value),response=await fetcher(metadata.publicUrl,{signal,credentials:'omit',redirect:'error'});
  if(!response.ok||Number(response.headers.get('Content-Length'))>64*1024*1024)throw error();
  const bytes=await response.arrayBuffer();if(!bytes.byteLength||bytes.byteLength>64*1024*1024)throw error();
  const revision=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
  if(revision!==metadata.revision)throw error();
  return {blob:new Blob([bytes],{type:metadata.mimeType}),source:'recording',reviewed:false,revision,provenance:metadata.provenance};
}
