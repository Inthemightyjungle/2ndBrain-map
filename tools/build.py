"""Build dist/inspirations-map.html: the page shell from src/shell3.html with src/style.css and src/app.js inlined."""
import os
root = os.path.join(os.path.dirname(__file__), '..')
rd = lambda p: open(os.path.join(root, p), encoding='utf-8').read()
s3 = rd('src/shell3.html')
body = s3[s3.index('</style>') + len('</style>'):].split('<script>')[0]
head = s3[:s3.index('<style>') + len('<style>\n')]
out = head + rd('src/style.css') + '</style>' + body + "<script>\n" + rd('src/app.js') + "</script>\n"
out = out.replace('<script src="https://cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/d3.min.js"></script>\n', '')
os.makedirs(os.path.join(root, 'dist'), exist_ok=True)
open(os.path.join(root, 'dist/inspirations-map.html'), 'w', encoding='utf-8').write(out)
print('built dist/inspirations-map.html', len(out), 'bytes')
