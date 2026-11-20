# Trip app

An offline travel app for iPhone that reads from the **!Europe 2026 Trip** Google Sheet.

- `index.html`, `app.js`, `styles.css`, `sw.js`, `manifest.webmanifest`, `icons/`, `vendor/` – the app (hosted on GitHub Pages). It holds no trip data.
- `config.js` – the one line to edit: the Apps Script web app URL.
- `apps-script/` – the backend that runs inside the Google Sheet. It checks the passcode, reads the sheet and the PDFs in its Drive folder, and hides Alex's surprises until 24 hours before they start.

## 1. Set up the Apps Script (about 5 minutes)

1. Open the sheet, then **Extensions → Apps Script**.
2. Replace everything in `Code.gs` with `apps-script/Code.gs`.
3. **Project Settings** (gear icon) → tick **Show "appsscript.json" manifest file in editor**. Back in the editor, replace `appsscript.json` with `apps-script/appsscript.json`. (This limits the script to reading this sheet and reading Drive.)
4. **Project Settings → Script properties → Add script property**:
   - `DAN_PASSCODE` = your passcode
   - `ALEX_PASSCODE` = Alex's passcode

   Use something longer than a PIN, such as three or four words.
5. In the editor, choose `testBuild` in the function menu and click **Run**. Approve the permissions. Google will say the app isn't verified because it's your own script: click **Advanced → Go to … (unsafe)**. The log lists anything in the sheet the app couldn't read.
6. **Deploy → New deployment** → type **Web app** → Execute as **Me**, Who has access **Anyone** → **Deploy**. Copy the **Web app URL** (it ends in `/exec`).

"Anyone" means the URL answers anyone, but it only returns trip data for a correct passcode. After 10 wrong passcodes it locks for 15 minutes.

**If you change `Code.gs` later:** Deploy → Manage deployments → edit (pencil) → Version: **New version** → Deploy. The URL stays the same.

## 2. Publish the app on GitHub Pages

1. Put the web app URL into `config.js`.
2. Upload all the files to the repo (Add file → Upload files, drag the folder contents in, Commit).
3. **Settings → Pages** → Source: **Deploy from a branch** → `main` / `(root)` → Save.
4. After a minute the app is at `https://belleroph0n.github.io/Travel-app/`.

## 3. Install on each iPhone

1. Open the Pages URL in **Safari** → Share → **Add to Home Screen**.
2. Open it **from the home screen icon** (the home screen app has its own storage, separate from Safari) and enter your passcode.
3. Wait until the menu (•••) shows **Documents 13/13 saved offline**. From then on it works with no internet.

It updates by itself whenever it's opened with internet. Tap the time at the top to update now.

## Using the sheet

- **Secret** column: `Y` hides the row from Alex until 24 hours before its start (departure time, check-in time, or plan start time, in local time). `N/A` hides the row from everyone (used for the cancelled Air Baltic flight).
- **Note for Alex (shown while secret)**: what Alex sees on the surprise card, e.g. "Pack an overnight bag".
- **Local Address**: shown large with a "Show driver" button.
- **Confirmation / Link / File link**: links to files in the same Drive folder as the sheet are saved on the phones for offline use. Other links are ignored.
- **Plans** tab: one row per restaurant or event. Date as `d/m/yy`, start time like `19:30`.
- Costs aren't shown anywhere in the app.
- Dates are `d/m/yy`. Times in the transport rows are read from patterns like `AKL 1955 > SFO 1105` (add `+1` for next-day arrival).

Alex's surprises are removed on the server, so her phone never has them. A surprise appears on her phone the next time the app updates after its reveal time. If she's offline then, it appears when she's next online.

When you're signed in as Dan, the menu has **Preview Alex's view** and **Sheet check**, which lists anything in the sheet the app couldn't read.

When you change any app file, bump `VERSION` in `sw.js` so phones pick up the new version.

PDF display uses [PDF.js](https://mozilla.github.io/pdf.js/) (Apache 2.0, see `vendor/PDFJS-LICENSE`).
