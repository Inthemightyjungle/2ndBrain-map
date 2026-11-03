"""Build docs/index.html: the map with the fictional sample data and an in-page stand-in for the Claude runtime (nothing is saved)."""
import json, os
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.join(HERE, "..")
DATA = json.load(open(os.path.join(HERE, "demo-data.json")))
stub = """<!doctype html><html lang="en"><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><style>body{margin:0;font:14px system-ui}[hidden]{display:none!important}
.demo-banner{position:fixed;left:50%;top:66px;transform:translateX(-50%);z-index:50;font:500 11px ui-monospace,monospace;color:#ffd166;background:rgba(10,18,29,.92);border:1px solid rgba(255,209,102,.4);border-radius:999px;padding:4px 12px;pointer-events:none;white-space:nowrap}</style></head><body><div class="demo-banner">Demo · made-up sample data · changes aren't saved</div><script>
(()=>{
const DATA=""" + json.dumps(DATA, ensure_ascii=False) + """;
const snap=(id,data)=>({id,exists:!!data,data:()=>data,metadata:{fromCache:false,hasPendingWrites:false}});
const coll=(path)=>({path,doc:(id)=>doc(path+'/'+(id||('x'+Math.random().toString(36).slice(2)))),
 onSnapshot:(next)=>{setTimeout(()=>{let docs=[];if(path==='authors')docs=[snap('u_demo',DATA.author)];else if(path.endsWith('/notes'))docs=Object.entries(DATA.notes).map(([k,v])=>snap(k,v));next({docs,size:docs.length,empty:!docs.length,docChanges:()=>[],metadata:{}})},50);return()=>{}}});
const doc=(path)=>({id:path.split('/').pop(),path,set:async()=>{},update:async()=>{},delete:async()=>{},get:async()=>snap(path,null),collection:(p)=>coll(path+'/'+p),
 onSnapshot:(next)=>{setTimeout(()=>next(snap(path,path==='settings/categories'?DATA.meta:null)),30);return()=>{}}});
const db={doc,collection:coll};
const user={id:async()=>'u_demo',isOwner:async()=>true,canEdit:async()=>true,can:async()=>true,profiles:async(ids)=>Object.fromEntries(ids.map(i=>[i,{id:i,name:'Demo',avatarUrl:'',color:'#888',email:null,isMe:true,guest:false}]))};
window.claude={use:async(n)=>n==='db'?db:n==='user'?user:null};})();
</script>
"""
app = open(os.path.join(ROOT, "dist", "inspirations-map.html"), encoding="utf-8").read()
i = app.index("<title>")
out = stub + app[i:].replace("<title>2nd Brain</title>", "<title>2nd Brain demo</title>", 1)
os.makedirs(os.path.join(ROOT, "docs"), exist_ok=True)
open(os.path.join(ROOT, "docs", "index.html"), "w", encoding="utf-8").write(out)
open(os.path.join(ROOT, "docs", ".nojekyll"), "w").close()
print("built docs/index.html", round(len(out.encode()) / 1e6, 2), "MB,", len(DATA["notes"]), "sample notes")
