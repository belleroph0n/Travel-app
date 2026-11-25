# Trip app

An offline travel app for iPhone that reads a trip itinerary from a Google Sheet.

- Day-by-day itinerary with a "Today" view: swipe or tap through the dates.
- Flights, trains, buses, car hire, accommodation and your own plans (restaurants, events), in time order across time zones.
- Booking refs you can copy, addresses with Map buttons, and a large "Show driver" view for addresses in the local script.
- Tickets and confirmations (PDFs in the sheet's Drive folder) saved on the phone and readable offline.
- Cancellation deadlines shown until they've passed.
- Two passcodes: one traveller sees everything. The other sees items marked **secret** as a "Surprise" card until 24 hours before they start.
- Updates from the sheet whenever it's opened with internet, and keeps the last copy for offline use.
- Costs in the sheet are never shown.

**Setting up your own copy?** Follow [REPLICATE.md](REPLICATE.md). It covers the sheet layout, the Google script, hosting and installing on the phones.

## What's in the repo

| Path | What it is |
|---|---|
| `index.html`, `app.js`, `styles.css`, `sw.js`, `manifest.webmanifest`, `icons/`, `vendor/` | The app, hosted on GitHub Pages. It contains no trip data. |
| `config.js` | The Apps Script web app URL and the trip name shown in the app. |
| `apps-script/Code.gs`, `apps-script/appsscript.json` | The backend. It runs inside the Google Sheet, checks the passcode, reads the sheet and its folder's PDFs, and hides surprises from the second traveller. |

## How privacy works

- The sheet stays private. The Google script reads it as its owner and returns data only for a correct passcode.
- Passcodes are stored in the script's **Script properties**, never in this repo.
- Surprises are removed on the server, so the second traveller's phone never receives them early. A surprise appears the next time their app updates after its reveal time.
- After 10 wrong passcodes, the script refuses all sign-ins for 15 minutes.
- The web app URL in `config.js` is not a secret on its own, but **each copy of the app must use its own URL**. Pointing a copy at someone else's script can trigger their lockout.

## Day-to-day use

- Edit the sheet as normal. The phones pick up changes the next time the app opens with internet. Tap the time at the top to update now.
- The menu (•••) shows how many documents are saved offline. When the count is complete, the app works without internet.
- The traveller with the main passcode also gets **Preview Alex's view** (the surprise view) and **Sheet check** (a list of anything in the sheet the app couldn't read).

## Making changes

- **Changed `Code.gs`?** In Apps Script: Deploy → Manage deployments → pencil icon → Version: **New version** → Deploy. The URL stays the same.
- **Changed any app file?** Bump `VERSION` in `sw.js` (e.g. `trip-v1` → `trip-v2`) so phones load the new version. It can take two opens of the app to appear.

## Troubleshooting

| Problem | Fix |
|---|---|
| Apps Script: "Operation failed. appsscript.json has invalid unsaved changes" | The file contains its path (`apps-script/appsscript.json`) instead of its contents. Open the file in this repo, copy everything inside it, and paste that over the file in Apps Script. Do the same for `Code.gs`. |
| Apps Script toolbar says "No functions" | `Code.gs` hasn't been pasted correctly. Line 1 should be `/**` and the file is about 550 lines. |
| "Google hasn't verified this app" | Expected for your own scripts. Click **Advanced** (small grey link, bottom left), then **Go to … (unsafe)**, then **Allow**. It should ask only to view this spreadsheet and to see your Drive files. |
| App says "That passcode didn't work" | Check the Script property names are exactly `DAN_PASSCODE` and `ALEX_PASSCODE` (see REPLICATE.md), with no extra spaces in the values. |
| App says "Couldn't reach the server" | The deployment's "Who has access" must be **Anyone**. Also check the URL in `config.js` ends in `/exec`. |
| App says "The app isn't connected to the sheet yet" | `config.js` still has `PASTE_WEB_APP_URL_HERE`. |
| "Too many attempts" | Wait 15 minutes. |
| An item is in the wrong order, or a time is missing | Open **Sheet check** in the menu. It names the row and what it couldn't read. |
| A document says "Not saved" | It's saved on the next update with internet. Only files in the same Drive folder as the sheet can be saved. |
| Changes to the app don't show on the phone | Bump `VERSION` in `sw.js`, then close and reopen the app twice. |
| Installed app shows the sign-in screen again | Safari and the home screen app keep separate storage. Always open it from the home screen icon. |

PDF display uses [PDF.js](https://mozilla.github.io/pdf.js/) (Apache 2.0, see `vendor/PDFJS-LICENSE`).
