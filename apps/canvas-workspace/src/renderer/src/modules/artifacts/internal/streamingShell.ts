/**
 * Streaming render shell shared by ChatInlineVisual (artifact streaming in
 * chat) and IframeNodeBody (artifact streaming inside a pinned canvas node).
 *
 * The shell is loaded into a sandboxed iframe via `srcdoc`. It contains:
 *  - morphdom from CDN (with a tiny innerHTML fallback if CDN fails)
 *  - a postMessage listener that morphs the visible DOM whenever the parent
 *    posts `{ type: 'morph', html }` with the latest accumulated HTML.
 *  - a ResizeObserver that posts `{ type: 'height', value }` to the parent
 *    whenever the document height changes — used by the chat inline visual
 *    to keep the iframe sized to its content (no fixed height).
 *
 * The parent (renderer component) calls `postMessage(...)` with the latest
 * accumulated HTML; the shell extracts <style> → applies to <head>,
 * extracts <body> content → morphdom diffs it in, strips <script> during
 * streaming (so partial scripts don't crash).
 *
 * Once the LLM finishes the parent swaps the iframe's srcdoc to the final
 * HTML so any <script> tags actually run. The final HTML should be wrapped
 * with `withAutoHeight()` so it continues to report height changes.
 */

export const STREAMING_SHELL = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>*,*::before,*::after{box-sizing:border-box}html,body{margin:0;font-family:system-ui,-apple-system,sans-serif;background:#fff}body{padding:0}</style>
<script src="https://cdn.jsdelivr.net/npm/morphdom@2/dist/morphdom-umd.min.js"
  onerror="window.morphdom=function(f,t){if(typeof t==='string'){var d=document.createElement('div');d.innerHTML=t;while(f.firstChild)f.removeChild(f.firstChild);while(d.firstChild)f.appendChild(d.firstChild)}else if(f.parentNode){f.parentNode.replaceChild(t,f)}}"></script>
</head><body>
<div id="__mr__"></div>
<script>
var root=document.getElementById("__mr__"),styleEl=null,prevCss="",lastH=0;
function reportH(){var h=document.documentElement.scrollHeight;if(h!==lastH){lastH=h;parent.postMessage({type:"height",value:h},"*")}}
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
  else root.innerHTML=body;
  reportH()
}
if(typeof ResizeObserver==="function"){try{new ResizeObserver(reportH).observe(document.documentElement)}catch(e){}}
window.addEventListener("message",function(e){
  if(e.data&&e.data.type==="morph")applyUpdate(e.data.html)
});
window.parent.postMessage({type:"morph-ready"},"*");
reportH();
</script>
</body></html>`;

/**
 * Wrap the LLM's final HTML so the resulting iframe also reports its
 * content height to the parent via `postMessage({type:'height',value})`.
 * Used after streaming finishes to keep the iframe auto-sized once we
 * swap from STREAMING_SHELL to the clean srcdoc that actually runs scripts.
 *
 * Idempotent — if the snippet is already present it leaves the HTML alone.
 */
export function withAutoHeight(html: string): string {
  if (!html) return html;
  if (html.includes('__pulse_auto_h__')) return html;
  const probe = `<script id="__pulse_auto_h__">(function(){var lastH=0;function r(){var h=document.documentElement.scrollHeight;if(h!==lastH){lastH=h;parent.postMessage({type:"height",value:h},"*")}}if(typeof ResizeObserver==="function"){try{new ResizeObserver(r).observe(document.documentElement)}catch(e){}}window.addEventListener("load",r);setTimeout(r,0);setTimeout(r,200);setTimeout(r,800);})();</script>`;
  // Inject just before </body> if we can find it; otherwise append.
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, `${probe}</body>`);
  return html + probe;
}

