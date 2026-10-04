import { downloadStaticAmbience } from './static-ambience';
import { getAccessToken } from '../auth/service';
import { getStorageOwner } from '../auth/storage-owner';
export interface ElevenVoice { id:string;name:string;description:string;previewUrl?:string;labels:Record<string,string> }
export interface AudioStatus { configured:boolean;model:string;soundModel:string;defaultVoiceId?:string;speech?:{defaultQuality:string;losslessMaxChars:number;losslessMaxBytes:number;losslessFormat:string};voiceChange?:{model:string;configured:boolean;maxDurationSeconds:number;losslessMaxDurationSeconds?:number;maxBytes:number;inputFormats:string[];paid:boolean} }
export interface VoicePage { voices:ElevenVoice[];hasMore?:boolean;nextPageToken?:string }
export interface AudioProvenance { label:string;source:string;license:string;licenseUrl?:string }
export interface AudioResourceMetadata { id:string;reviewed:boolean;source:'library'|'recording';revision:string;mimeType:string;durationSeconds:number;acoustic?:{directSound:'included'|'removed';directArrivalMs?:number;directWindowMs?:number;predelayMode:'embedded'|'external';predelayMs?:number;wet?:number} }
export interface EnvironmentReadiness { id:string;mode:'silent'|'bed';status:'silent'|'approved'|'recorded'|'generated'|'missing';reviewed:boolean;source?:string;revision?:string;provenance?:AudioProvenance;resources?:{ir:AudioResourceMetadata|null;events:AudioResourceMetadata[]} }
export interface AmbienceAsset { blob:Blob;source:'library'|'recording'|'cache'|'generated'|'silent';reviewed:boolean;revision:string;provenance?:AudioProvenance }

export class AudioApiError extends Error {
  code:string;
  constructor(message:string,code='REQUEST_FAILED'){super(message);this.name='AudioApiError';this.code=code;}
}
async function authenticatedFetch(url:string, options:RequestInit={}):Promise<Response> {
  const owner=getStorageOwner();
  const token=await getAccessToken();
  if(!owner||!token||getStorageOwner()!==owner)throw new AudioApiError('Entre na sua conta para continuar.','AUTH_REQUIRED');
  const headers=new Headers(options.headers);headers.set('Authorization',`Bearer ${token}`);
  return fetch(url,{...options,headers});
}
async function responseError(response:Response):Promise<never> {
  const body=await response.json().catch(()=>null);
  throw new AudioApiError(body?.error?.message||'Não foi possível concluir a geração. Tente novamente.',body?.error?.code||'REQUEST_FAILED');
}
export async function getAudioStatus(signal?:AbortSignal):Promise<AudioStatus> {
  const response=await authenticatedFetch('/api/audio/status',{signal});if(!response.ok)return responseError(response);return response.json();
}
export async function getElevenVoices(nextPageToken?:string,signal?:AbortSignal,filters?:{language?:string;search?:string}):Promise<VoicePage> {
  const query=new URLSearchParams();if(nextPageToken)query.set('nextPageToken',nextPageToken);
  if(filters?.language)query.set('language',filters.language);if(filters?.search)query.set('search',filters.search);
  const response=await authenticatedFetch(`/api/audio/voices?${query}`,{signal});if(!response.ok)return responseError(response);return response.json();
}
/** Uploaded guide performance is sent only when the user requests conversion. */
export async function createVoiceChange(body:{audio:Blob;voiceId:string;quality:'standard'|'high'|'lossless';removeBackgroundNoise:boolean},signal:AbortSignal):Promise<{blob:Blob;model:string}> {
  const form=new FormData();form.append('audio',body.audio,'guide.wav');form.append('voiceId',body.voiceId);form.append('quality',body.quality);form.append('removeBackgroundNoise',String(body.removeBackgroundNoise));
  const response=await authenticatedFetch('/api/audio/voice-change',{method:'POST',body:form,signal});if(!response.ok)return responseError(response);
  return {blob:await response.blob(),model:response.headers.get('X-Voice-Model')||'eleven_multilingual_sts_v2'};
}
export async function createSpeech(body:{text:string;voiceId:string;mood:string;quality:'standard'|'high'|'lossless'},signal:AbortSignal):Promise<Blob> {
  const response=await authenticatedFetch('/api/audio/speech',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal});
  if(!response.ok)return responseError(response);return response.blob();
}
export async function getEnvironmentReadiness(signal?:AbortSignal):Promise<EnvironmentReadiness[]> {
  const response=await authenticatedFetch('/api/audio/environments',{signal});if(!response.ok)return responseError(response);
  const body=await response.json();return body.environments;
}
async function ambienceResponse(response:Response):Promise<AmbienceAsset> {
  if(!response.ok)return responseError(response);
  const source=response.headers.get('X-Ambience-Source');
  if(!['library','recording','cache','generated','silent'].includes(source||''))throw new AudioApiError('O servidor devolveu um ambiente sem identificação. Atualize a API local.','INVALID_AMBIENCE');
  let provenance:AudioProvenance|undefined;const raw=response.headers.get('X-Ambience-Provenance');
  if(raw)try{const value=JSON.parse(decodeURIComponent(raw));if(typeof value.label==='string'&&typeof value.source==='string'&&typeof value.license==='string')provenance=value;}catch{/* Optional attribution never prevents playback of a valid prepared file. */}
  return {blob:await response.blob(),source:source as AmbienceAsset['source'],reviewed:response.headers.get('X-Ambience-Reviewed')==='true',revision:response.headers.get('X-Ambience-Revision')||'',provenance};
}
/** Reads a prepared clip. This endpoint never starts a paid generation. */
export async function getPreparedAmbience(environment:string,signal?:AbortSignal):Promise<AmbienceAsset> {
  const response=await authenticatedFetch(`/api/audio/ambience/${encodeURIComponent(environment)}?metadata=1`,{signal});
  if(!response.ok)return responseError(response);
  if(response.headers.get('Content-Type')?.includes('application/json'))return downloadStaticAmbience(await response.json(),signal);
  return ambienceResponse(response);
}
export async function createAmbience(environment:string,signal?:AbortSignal):Promise<AmbienceAsset> {
  const response=await authenticatedFetch('/api/audio/ambience',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({environment}),signal});
  return ambienceResponse(response);
}
/** Prepared room response; only reads a local resource and never starts generation. */
export async function getPreparedImpulse(environment:string,signal?:AbortSignal):Promise<{blob:Blob;metadata:AudioResourceMetadata}> {
  const response=await authenticatedFetch(`/api/audio/ir/${encodeURIComponent(environment)}`,{signal});if(!response.ok)return responseError(response);
  let metadata:AudioResourceMetadata;try{metadata=JSON.parse(decodeURIComponent(response.headers.get('X-Audio-Resource-Metadata')||''));if(!metadata||typeof metadata.id!=='string'||!['library','recording'].includes(metadata.source)||typeof metadata.reviewed!=='boolean'||!metadata.acoustic)throw new Error();}catch{throw new AudioApiError('A resposta de sala veio sem metadados válidos. Atualize a biblioteca local.','INVALID_RESOURCE');}
  return {blob:await response.blob(),metadata};
}
/** Reads an approved local event. This endpoint never starts a generation. */
export async function getPreparedEvents(environment:string,eventId:string,signal?:AbortSignal):Promise<{blob:Blob;metadata:AudioResourceMetadata}> {
  const response=await authenticatedFetch(`/api/audio/events/${encodeURIComponent(environment)}/${encodeURIComponent(eventId)}`,{signal});if(!response.ok)return responseError(response);
  let metadata:AudioResourceMetadata;try{metadata=JSON.parse(decodeURIComponent(response.headers.get('X-Audio-Resource-Metadata')||''));if(!metadata||typeof metadata.id!=='string'||!['library','recording'].includes(metadata.source)||typeof metadata.reviewed!=='boolean')throw new Error();}catch{throw new AudioApiError('O evento veio sem metadados válidos. Atualize a biblioteca local.','INVALID_RESOURCE');}
  return {blob:await response.blob(),metadata};
}
