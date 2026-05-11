/**
 * Streaming render shell shared by ChatInlineVisual (artifact streaming in
 * chat) and IframeNodeBody (artifact streaming inside a pinned canvas node).
 *
 * The shell is loaded into a sandboxed iframe via `srcdoc`. It contains:
 *  - morphdom from CDN (with a tiny innerHTML fallback if CDN fails)
 *  - a postMessage listener that morphs the visible DOM whenever the parent
 *    posts `{ type: 'morph', html }` with the latest accumulated HTML.
 *
 * The parent (renderer component) calls `postMessage(...)` with the latest
 * accumulated HTML; the shell extracts <style> → applies to <head>,
 * extracts <body> content → morphdom diffs it in, strips <script> during
 * streaming (so partial scripts don't crash).
 *
 * Once the LLM finishes the parent swaps the iframe's srcdoc to the final
 * HTML so any <script> tags actually run.
 */

export const STREAMING_SHELL = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>*,*::before,*::after{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,sans-serif;background:#fff}</style>
<script src="https://cdn.jsdelivr.net/npm/morphdom@2/dist/morphdom-umd.min.js"
  onerror="window.morphdom=function(f,t){if(typeof t==='string'){var d=document.createElement('div');d.innerHTML=t;while(f.firstChild)f.removeChild(f.firstChild);while(d.firstChild)f.appendChild(d.firstChild)}else if(f.parentNode){f.parentNode.replaceChild(t,f)}}"></script>
</head><body>
<div id="__mr__"></div>
<script>
var root=document.getElementById("__mr__"),styleEl=null,prevCss="";
function applyUpdate(html){
  var css="";
  html.replace(/<style[^>]*>([\\s\\S]*?)<\\/style>/gi,function(_,c){css+=c});
  if(css&&css!==prevCss){
    if(!styleEl){styleEl=document.createElement("style");styleEl.id="__sc__";document.head.appendChild(styleEl)}
    styleEl.textContent=css;prevCss=css
  }
  var body,bm=html.match(/<body[^>]*>([\\s\\S]*?)(<\\/body>|$)/i);
  if(bm){body=bm[1]}
  else{
    var bi=html.indexOf("<body");
    if(bi===-1)return;
    var gt=html.indexOf(">",bi);
    if(gt===-1)return;
    body=html.slice(gt+1)
  }
  body=body.replace(/<script[\\s\\S]*?(<\\/script>|$)/gi,"").trim();
  if(!body)return;
  var nx=document.createElement("div");nx.id="__mr__";nx.innerHTML=body;
  if(typeof morphdom==="function"){try{morphdom(root,nx)}catch(e){root.innerHTML=body}}
  else root.innerHTML=body
}
window.addEventListener("message",function(e){
  if(e.data&&e.data.type==="morph")applyUpdate(e.data.html)
});
window.parent.postMessage({type:"morph-ready"},"*");
</script>
</body></html>`;
