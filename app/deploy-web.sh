#!/bin/bash
# Build the API-mode static web app and deploy it to the couple-ledger-web
# Vercel project (https://couple-ledger-web-alpha.vercel.app).
# Notes: a custom +html.tsx breaks bundle script injection in this SDK's
# static export, so the PWA/home-screen tags are injected into the exported
# HTML here instead. public/vercel.json (SPA fallback) ships via public/.
set -euo pipefail
cd "$(dirname "$0")"
VERCEL=~/workspace/tools/vercel-npm/node_modules/.bin/vercel

cp app.json /tmp/cl-app.json.bak
restore() { cp /tmp/cl-app.json.bak app.json; }
trap restore EXIT
python3 -c "
import json
c = json.load(open('app.json'))
c['expo']['web']['output'] = 'static'
json.dump(c, open('app.json','w'), indent=2, ensure_ascii=False)
"
EXPO_NO_TELEMETRY=1 npx expo export --platform web --output-dir dist-static
restore
trap - EXIT

python3 - <<'PY'
import pathlib
tags = ('<title>Couple Ledger</title>'
        '<meta name="theme-color" content="#FAF8F4" />'
        '<meta name="mobile-web-app-capable" content="yes" />'
        '<meta name="apple-mobile-web-app-capable" content="yes" />'
        '<meta name="apple-mobile-web-app-status-bar-style" content="default" />'
        '<meta name="apple-mobile-web-app-title" content="Couple Ledger" />'
        '<link rel="apple-touch-icon" href="/apple-touch-icon.png" />'
        '<link rel="icon" type="image/png" href="/icon.png" />')
for f in pathlib.Path('dist-static').rglob('*.html'):
    html = f.read_text()
    if 'apple-mobile-web-app-capable' not in html and '</head>' in html:
        f.write_text(html.replace('</head>', tags + '</head>', 1))
        print('injected:', f)
PY

grep -q '<script defer' dist-static/index.html || { echo "ERROR: bundle scripts missing from export"; exit 1; }
cd dist-static
"$VERCEL" link --project couple-ledger-web --yes > /dev/null
"$VERCEL" deploy --prod --yes
cd ..
rm -rf dist-static
echo "Deployed: https://couple-ledger-web-alpha.vercel.app"
