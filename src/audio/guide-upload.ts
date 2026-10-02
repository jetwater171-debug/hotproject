/** API guide upload stays below Vercel's 4.5 MB buffered request limit. */
export const GUIDE_MAX_SECONDS=120;
export const GUIDE_MAX_BYTES=4*1024*1024;
export async function prepareGuideUpload(buffer:AudioBuffer):Promise<Blob> {
  if(!buffer.length||buffer.duration>GUIDE_MAX_SECONDS||buffer.duration<=0)throw new Error('Use uma interpretação de até 120 segundos.');
  const context=new OfflineAudioContext(1,Math.ceil(buffer.duration*16000),16000);
  const source=context.createBufferSource();source.buffer=buffer;
  const lowpass=context.createBiquadFilter();lowpass.type='lowpass';lowpass.frequency.value=7200;lowpass.Q.value=.707;
  source.connect(lowpass);lowpass.connect(context.destination);source.start();
  const mono=await context.startRendering(),data=mono.getChannelData(0),raw=new ArrayBuffer(44+data.length*2),view=new DataView(raw);
  const word=(offset:number,value:string)=>{for(let i=0;i<value.length;i++)view.setUint8(offset+i,value.charCodeAt(i));};
  word(0,'RIFF');view.setUint32(4,raw.byteLength-8,true);word(8,'WAVE');word(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,16000,true);view.setUint32(28,32000,true);view.setUint16(32,2,true);view.setUint16(34,16,true);word(36,'data');view.setUint32(40,data.length*2,true);
  for(let i=0;i<data.length;i++){const sample=Math.max(-1,Math.min(1,Number.isFinite(data[i])?data[i]:0));view.setInt16(44+i*2,Math.round(sample*(sample<0?32768:32767)),true);}
  const blob=new Blob([raw],{type:'audio/wav'});if(blob.size>GUIDE_MAX_BYTES)throw new Error('A guia ultrapassou o limite de envio. Use um trecho menor.');return blob;
}
