// Marker line the bookmark puts at the top of copied page text (iPhone flow).
export const PAGE_MARKER = 'PackTrack page: ';

// The bookmark ("bookmarklet") collects the page text and tracking-looking links.
// - iPhone/iPad: copies them to the clipboard, so they can be pasted into PackTrack
//   (a home-screen app has its own storage, so opening PackTrack in Safari wouldn't help).
// - Computers: opens PackTrack with the data in the URL fragment (fragments never leave
//   the browser, and window.open isn't blocked by the shop's CSP).
export function bookmarkletSource(app) {
  return `(()=>{
const A=${JSON.stringify(app)};
const L=[...document.links].map(a=>a.href).filter(h=>/track|seuranta|sendung|parcel|shipment|lahetys|17track|aftership|parcelsapp/i.test(h)).slice(0,150);
let t=(document.body.innerText||'').slice(0,60000);
t=t.toWellFormed?t.toWellFormed():t.replace(/[\\uD800-\\uDFFF]/g,'');
const ios=/iPhone|iPad|iPod/.test(navigator.userAgent)||(navigator.maxTouchPoints>1&&/Mac/.test(navigator.platform));
const open=()=>window.open(A+'#import='+encodeURIComponent(JSON.stringify({url:location.href,title:document.title,text:t+'\\n'+L.join('\\n')})),'_blank');
if(!ios){open();return;}
const s=${JSON.stringify(PAGE_MARKER)}+location.href+'\\n'+document.title+'\\n'+t+'\\n'+L.join('\\n');
const msg='Order details copied. Open PackTrack and tap Take from email, then Paste from clipboard.';
const x=document.createElement('textarea');
x.value=s;x.contentEditable='true';x.readOnly=false;x.style.cssText='position:fixed;top:0;left:0;width:1px;height:1px;opacity:0';
document.body.appendChild(x);
const r=document.createRange();r.selectNodeContents(x);const g=getSelection();g.removeAllRanges();g.addRange(r);x.setSelectionRange(0,s.length);
let ok=false;try{ok=document.execCommand('copy');}catch(e){}
x.remove();
if(ok){alert(msg);return;}
if(navigator.clipboard){navigator.clipboard.writeText(s).then(()=>alert(msg),open);}else{open();}
})()`.replace(/\n/g, '');
}

// Text pasted from the bookmark starts with "PackTrack page: <url>" and the page title.
export function parsePasted(text) {
  if (!text.startsWith(PAGE_MARKER)) return null;
  const [first, title = '', ...rest] = text.split('\n');
  return { url: first.slice(PAGE_MARKER.length).trim(), title, text: rest.join('\n') };
}
