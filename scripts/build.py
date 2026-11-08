import re,sys
src=open(sys.argv[1],encoding='utf-8').read()
helmet=re.search(r'<helmet>(.*?)</helmet>',src,re.S).group(1)
body=re.search(r'</helmet>(.*?)</x-dc>',src,re.S).group(1)
script=re.search(r'<script type="text/x-dc"[^>]*>(.*?)</script>',src,re.S).group(1)
runtime=open(sys.argv[2],encoding='utf-8').read()
out=f'''<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0E6B2C">
<title>북이랑 - 책 찍고 AI랑 도란도란</title>
{helmet.strip()}
<style>
html,body{{height:100%}}
body{{display:flex;align-items:center;justify-content:center;min-height:100vh;background:#EEF1EE !important}}
#app>div{{box-shadow:0 20px 60px rgba(0,0,0,.12);border-radius:32px}}
@media (max-width:1024px), (pointer:coarse){{
body{{display:block;background:#FFFFFF !important}}
#app>div{{width:100% !important;height:100vh !important;height:100dvh !important;border-radius:0;box-shadow:none}}
#app>div>.scroll,#app>div>div{{padding-left:max(20px, calc((100% - 720px) / 2)) !important;padding-right:max(20px, calc((100% - 720px) / 2)) !important}}
#app>div>nav{{padding-left:max(0px, calc((100% - 720px) / 2));padding-right:max(0px, calc((100% - 720px) / 2))}}
}}
</style>
</head>
<body>
<div id="app"></div>
<template id="tpl">
{body.strip()}
</template>
<script>
{runtime}
</script>
<script>
{script.strip()}
mount(Component);
</script>
</body>
</html>
'''
open(sys.argv[3],'w',encoding='utf-8').write(out)
