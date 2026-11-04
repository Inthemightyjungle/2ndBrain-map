#!/bin/bash
# 2nd Brain: publish to Firebase (Mac). Run with:  bash deploy-mac.sh
cd "$(dirname "$0")" || exit 1
[ -f firebase.json ] || { echo "Run this from the firebase folder of the downloaded Inspirations-map-main folder."; exit 1; }
command -v node >/dev/null || { echo "Node.js isn't installed. Install the LTS version from nodejs.org, then run this again."; open https://nodejs.org; exit 1; }
echo "[1/5] Installing the Firebase tools..."; npm install -g firebase-tools >/dev/null 2>&1 || sudo npm install -g firebase-tools
echo "[2/5] Signing in (a browser opens)..."; firebase login
if [ -f .firebaserc ]; then echo "[3/5] Project already chosen."; else echo "[3/5] Pick your project, then type default as the alias."; firebase use --add; fi
echo "[4/5] Claude API key (paste it if asked; it stays on Google's servers)..."
firebase functions:secrets:get ANTHROPIC_API_KEY >/dev/null 2>&1 || firebase functions:secrets:set ANTHROPIC_API_KEY
echo "[5/5] Publishing..."; firebase deploy
echo "Finished. Open the Hosting URL above, sign in, then Account > Import backup."
