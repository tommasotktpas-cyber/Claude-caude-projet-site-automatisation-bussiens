import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs';
import { spawn } from 'child_process';
const [mode, ...vs] = process.argv.slice(2);
const b = await chromium.launch();
const FPS=30;
for (const v of vs) {
  const p = await b.newPage({ viewport:{width:1080,height:1920} });
  p.on('pageerror', e=>console.log('ERR v'+v, e.message));
  await p.goto(`http://localhost:8766/reel.html?v=${v}`);
  await p.waitForFunction(()=>window.READY);
  if (mode==='preview') {
    for (const t of (process.env.TS||'0.25,0.6,1.0,1.6,2.1').split(',').map(Number)) { await p.evaluate(t=>render(t), t); await p.screenshot({path:`${process.env.PD||'prev'}/v${v}_${t}.jpg`,type:'jpeg',quality:70}); }
  } else {
    const ff = spawn('ffmpeg',['-y','-loglevel','error','-f','image2pipe','-framerate',FPS,'-i','-','-f','lavfi','-i','anullsrc=r=44100:cl=stereo','-shortest','-c:v','libx264','-preset','medium','-crf','18','-pix_fmt','yuv420p','-c:a','aac','-movflags','+faststart',`${process.env.OD||"out"}/reel_${String(v).padStart(2,'0')}.mp4`]);
    const N=Math.round(await p.evaluate(()=>window.TOTAL)*FPS);
    for (let i=0;i<N;i++){ await p.evaluate(t=>render(t), i/FPS); const buf=await p.screenshot({type:'jpeg',quality:92}); if(!ff.stdin.write(buf)) await new Promise(r=>ff.stdin.once('drain',r)); }
    ff.stdin.end(); await new Promise(r=>ff.on('close',r)); console.log('done',v);
  }
  await p.close();
}
await b.close();
