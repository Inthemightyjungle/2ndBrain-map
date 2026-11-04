"""Build firebase/public/: index.html (the app's markup and styles, a sign-in gate, and the app code held inert until
sign-in), plus shim.js and account.js. Run after tools/splice.sh so ../src/app.js is current."""
import os, shutil
HERE = os.path.dirname(os.path.abspath(__file__)); FB = os.path.join(HERE, ".."); SRC = os.path.join(FB, "..", "src")
rd = lambda p: open(p, encoding="utf-8").read()
s3 = rd(os.path.join(SRC, "shell3.html"))
head = s3[:s3.index("<style>") + len("<style>\n")]
body = s3[s3.index("</style>") + len("</style>"):].split("<script>")[0]
body = body.replace('<script src="https://cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/d3.min.js"></script>\n', "")
app = rd(os.path.join(SRC, "app.js"))
assert "</script" not in app and "<!--" not in app
gate = rd(os.path.join(FB, "web", "gate.html"))
css = rd(os.path.join(SRC, "style.css")) + "\n" + rd(os.path.join(FB, "web", "gate.css"))
head = head.replace("<title>2nd Brain</title>", "<title>2nd Brain</title>\n<meta name=\"robots\" content=\"noindex,nofollow\">")
# the shell is written as an artifact body (no html/head/body tags), so wrap it in a full document here
out = ('<!doctype html><html lang="en"><head><meta charset="utf-8">'
       '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
       '<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 32 32%22%3E%3Ccircle cx=%2216%22 cy=%2216%22 r=%229%22 fill=%22%2338e1ff%22/%3E%3C/svg%3E">\n'
       + head + "*,*::before,*::after{box-sizing:border-box}html,body{margin:0;height:100%}body{font:14px system-ui}[hidden]{display:none!important}\n" + css + "</style></head>\n"
       + '<body class="gated">' + body + gate + "\n"
       + '<script type="text/plain" id="sb-app">\n' + app + "</script>\n"
       + '<script type="module" src="shim.js"></script>\n</body></html>\n')
pub = os.path.join(FB, "public"); os.makedirs(pub, exist_ok=True)
open(os.path.join(pub, "index.html"), "w", encoding="utf-8").write(out)
for f in ("shim.js", "account.js"): shutil.copy(os.path.join(FB, "web", f), os.path.join(pub, f))
print("built firebase/public/index.html", len(out.encode()) // 1024, "KB")
