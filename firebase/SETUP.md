# 2nd Brain on Firebase: setup

This folder turns 2nd Brain into its own website:

- **Sign-in:** people sign in with Google, Microsoft or an emailed link.
- **Access:** only emails on the team list can read or write anything. The server's security rules check this on every request.
- **AI:** Claude runs through a server function, so the API key never reaches the browser.
- **Microphone and camera:** they work normally here, so live voice notes and hand gestures don't need a workaround.

You do steps 1–4 once, in a browser. Steps 5–8 need a computer with Node.js 20 or newer.

## 1. Create the project

1. Go to https://console.firebase.google.com and choose **Create a project**. Name it, for example `second-brain-sde`. Google Analytics isn't needed.
2. Open **Upgrade** at the bottom left and pick the **Blaze (pay as you go)** plan. Firebase needs it for server functions, secrets and new storage buckets. At a small team's usage it should cost little or nothing apart from Claude API usage, which is billed by Anthropic.
3. In Google Cloud **Billing › Budgets & alerts**, set a budget alert, for example US$10 a month.

## 2. Switch on sign-in

**Build › Authentication › Get started › Sign-in method**:

- **Google:** enable it.
- **Email/Password (optional):** enable it, then tick **Email link (passwordless sign-in)**. Leave plain passwords off.
- **Microsoft (optional):** this needs an app registration in Azure. Skip it unless the team signs in with Microsoft 365.

Then go to **Authentication › Settings › Authorized domains**. Your `*.web.app` address is already there; add any custom domain you use later.

For extra protection, ask everyone to turn on 2-step verification for the Google or Microsoft account they sign in with.

## 3. Create the database and storage

1. **Build › Firestore Database › Create database:** choose **Production mode** and location **asia-southeast1 (Singapore)**.
2. **Build › Storage › Get started:** use the same location. Thumbnails are kept here, readable only by the team.

## 4. Put yourself on the team list

In **Firestore Database › Data**, create:

- **Collection:** `config`. **Document ID:** `access`.
- **Field:** `members`, of type **map**. Inside it, add one entry:
  - **Key:** your sign-in email in lowercase, for example `capdev.one@gmail.com`.
  - **Type:** map, with these fields:
    - `role` (string) = `owner`
    - `id` (string) = `u_BmKnDhwvKFEBrBUuaV026w` (this keeps the existing notes yours)
    - `name` (string) = `SS`

You add everyone else later from inside the app.

## 5. Get the tools

On your computer:

```bash
npm install -g firebase-tools
firebase login
git clone https://github.com/Inthemightyjungle/Inspirations-map.git
cd Inspirations-map/firebase
firebase use --add          # pick the project you created, call it "default"
```

## 6. Add the Claude API key, as a server secret

Create a key at https://platform.claude.com, under **API keys**, then run:

```bash
firebase functions:secrets:set ANTHROPIC_API_KEY
```

Paste the key when it asks. The key lives in Google Secret Manager: only the `claude` function can read it, and it's never in the code or the page.

Optional settings go in `functions/.env`:

- `MODEL_QUICK`, `MODEL_DEFAULT`, `MODEL_COMPLEX`: which Claude model each tier uses.
- `DAILY_LIMIT`: AI calls per person per day. The default is 400.

## 7. Deploy

```bash
python3 tools/build_web.py     # builds public/ from ../src
firebase deploy                # site, security rules, storage rules and the function
```

When it finishes, it prints the site address, for example `https://second-brain-sde.web.app`.

## 8. Move the data across and invite the team

1. Open the site and sign in with the email from step 4.
2. Go to **Account** (top right) › **Import backup…** and choose `2nd-brain-backup.json`. It loads every note, category, project, calendar entry and thumbnail, then reloads to show them.
3. Go to **Account › Who can sign in**, add teammates' emails, choose a role and press **Save team list**. Roles:
   - **member:** can read everything and edit their own notes.
   - **admin:** can also edit anyone's notes and the categories.
   - **owner:** can also change the team list.

   Removing someone cuts their access straight away.

## Updating the app later

After a change to the map's code in `../src`:

```bash
python3 tools/build_web.py && firebase deploy --only hosting
```

## What runs where

| Piece | Where |
| --- | --- |
| Site | Firebase Hosting, `public/` |
| Who can get in | Firebase Auth + `config/access`, enforced by `firestore.rules` and `storage.rules` |
| Notes, categories, projects, calendar | Firestore (`authors/{id}/notes`, `settings/*`) |
| Thumbnails | Cloud Storage `thumbs/` (team only) |
| AI (summaries, link filing, Ask, Recalibrate) | `functions/index.js`: `claude`, region asia-southeast1 |

## Not moved yet

The daily Notion/calendar sync, the Instagram rescan and the weekday push briefing still write to the Claude version of 2nd Brain. Until they're moved over, refresh this site by exporting a new backup and importing it again.
