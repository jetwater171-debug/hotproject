import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const processes=[];
let stopping=false;
function stop(code=0) {
  if(stopping)return;stopping=true;
  for(const child of processes)child.kill();
  setTimeout(()=>process.exit(code),150).unref();
}
for(const [script,args] of [
  ['server/index.mjs',[]],
  ['node_modules/vite/bin/vite.js',['--host','127.0.0.1','--port','5173','--strictPort',...process.argv.slice(2)]],
]){
  const child=spawn(process.execPath,[script,...args],{cwd:root,stdio:'inherit',windowsHide:true});processes.push(child);
  child.on('error',()=>stop(1));child.on('exit',code=>{if(!stopping)stop(code??1)});
}
process.on('SIGINT',()=>stop());process.on('SIGTERM',()=>stop());
