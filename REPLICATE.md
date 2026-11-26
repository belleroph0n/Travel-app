# How to set up your own copy of the trip app

This guide takes you from nothing to the app running offline on your iPhone. Allow about an hour, most of it filling in your trip.

You'll need:
- a Google account (for the sheet and the script)
- a GitHub account (free) to host the app
- an iPhone with Safari

There are three parts:
- **Your Google Sheet** holds the trip. It stays private.
- **A Google Apps Script** inside the sheet. It checks the passcode and sends the trip to the app.
- **The app**, hosted free on GitHub Pages. It contains no trip data.

---

## Step 1: Copy the repo

1. Open the repo on GitHub and click **Fork** (top right). If the owner shared a zip instead, create a new repository and upload the zip's contents.
2. Give it any name, e.g. `trip-app`. Your app's address will be `https://<your-username>.github.io/<repo-name>/`.

**Important:** don't use the original owner's script URL in `config.js`. Your copy must point to your own script (Step 4).

---

## Step 2: Build the sheet

The script expects a particular layout. Column **headings** must match exactly; the column order mostly doesn't matter, except where noted.

### Tab 1: `Flights and Accommodation`

The tab must have exactly this name. It holds two tables, one above the other.

#### Transport table (starts in row 1)

Row 1 headings. The date must be in column A; the other columns are found by their headings.

| Column | Heading | What goes in it | Example |
|---|---|---|---|
| A | `Travel date` | Date as **d/m/yy** | `10/12/26` |
| B | `Secret (Y/N)` | `Y` = surprise for the second traveller, `N` = normal, `N/A` = hide from everyone (e.g. a cancelled booking) | `N` |
| C | `Detail` | Short title. Use `no travel` for days without travel | `Flight to London` |
| D | `Flight` | Service and route, in the format below. On a `no travel` day, put the city here | `BA184 - EWR 1830 > LHR 0630 +1` |
| E | `Reference / Carrier` | Booking ref | `ABC123` |
| F | (anything) | Not used | |
| G–H | (anything) | Costs or payment notes. **Never shown in the app** | |
| I | `Carrier` | Airline or operator | `British Airways` |
| J | `Baggage limits` | Free text | `1x 23kg checked` |
| K | `Notes` | Free text | |
| L | `Confirmation` | Link(s) to ticket files (see "Tickets" below) | |
| M | `Notes 2` | Free text | |
| N | `Note for Alex (shown while secret)` | What the second traveller sees on a surprise card | `Pack an overnight bag` |

**Route format** for the `Flight` column, so the app can read times:

```
<service> - <FROM> <hhmm> > <TO> <hhmm> [+1]
```

- `NZ8 - AKL 1955 > SFO 1105`
- `CD PRG 0920 > CSK 1149` (train)
- `BA184 - EWR 1830 > LHR 0630 +1` (`+1` = arrives the next day)

FROM and TO are three-letter airport or station codes. Anything not in this format (e.g. `Train from Brussels to Bruges`) shows as a "Flexible, not booked" card. That's fine for untimed legs.

One row per leg. A connecting flight is two rows.

#### Accommodation table (below the transport table)

Leave at least one blank row after the transport table. Then a heading row whose column A says exactly `Accommodation Date`.

| Column | Heading | What goes in it | Example |
|---|---|---|---|
| A | `Accommodation Date` | The **night**, d/m/yy | `15/12/26` |
| B | (anything) | Secret: `Y` / `N` | `N` |
| C | `Detail` | City | `London` |
| D | `Accommodation` | Hotel name | `The July` |
| E | `Address` | Full address, including the **country** | `282 Vauxhall Bridge Road, London, SW1V 1BB, United Kingdom` |
| F | `Local Address` | Address in the local script (optional). Shown large on the "Show driver" screen | `〒108-0074 東京都港区高輪2-16-29` |
| G–H | (anything) | Costs. Never shown. If column H mentions "pay at property", the app tags it | |
| I | `Agent` | Booking site. `Expedia itinerary - 12345` puts `12345` as the ref | `Booking.com` |
| J | `Check-in and check-out` | Exactly this pattern | `15/12/26 after 1500, 17/12/26 before 1100` |
| K | `Cancellation option` | `non-refundable`, or `until d/m/yy` (becomes a deadline) | `until 11/12/26` |
| L | `Link` | Ticket/confirmation file link | |
| M | (anything) | Notes | |
| N | `Note for Alex (shown while secret)` | Surprise card text | `Bring warm layers` |

Rules:
- **One row per night.** Consecutive nights at the same hotel (same name in column D) are joined into one stay. Later rows can say `see above`.
- Nights spent travelling: put `Flight` in column D, or leave it blank.
- The table ends at a row whose column A says `Other`, or at the end of the sheet.

### Tab 2: `Plans`

Restaurants, gigs, tours and so on. Row 1 headings:

| Heading | Example |
|---|---|
| `Date` | `16/12/26` |
| `Time` | Start and finish, e.g. `1800-2000` (or just `1930` for a start time only) |
| `Name` | `Dinner at Dishoom` |
| `Type` | `Restaurant` |
| `Address` | include the city or country |
| `Local Address` | optional |
| `Booking ref` | |
| `Notes` | |
| `Secret` | `Y` / `N` |
| `File link` | link to a ticket file |
| `Note for Alex (shown while secret)` | `Dress up a bit` |
| `Website` | optional, e.g. `https://example.com`. Shown as a Website button (needs internet) |

Any other tabs are ignored.

### Tickets and confirmations

- Put PDFs (or images) in the **same Google Drive folder as the sheet**.
- In the link column, link to the file: select the cell, Insert → Link, paste the file's Drive link.
- For one ticket each, type both names in the cell (e.g. `Sam` and `Jo` on separate lines) and link each name to its own file. The app shows "Sam's ticket" and "Jo's ticket".
- Links to booking websites or emails are ignored, because they can't work offline.

### Secrets

- A secret item shows on the second traveller's phone as a pink "Surprise" card with the time and your note, until **24 hours before** it starts (departure time, check-in time or plan start, in local time).
- Each row is revealed on its own schedule. Keep secret places out of the titles of non-secret rows. For example, a non-secret "Flight to Paris" gives away a secret Paris hotel.
- Make sure the second traveller can't open the sheet or its Drive folder, or they'll see everything there.

---

## Step 3: Set up the Google script

1. In the sheet: **Extensions → Apps Script**.
2. **Copy the code, not the path.** Open `apps-script/Code.gs` in your repo on GitHub, click the **Copy raw file** button (two overlapping squares, top right of the code), then in Apps Script select everything in `Code.gs` and paste.
   - Check: line 1 is `/**` and the file is about 550 lines.
3. Click the gear (**Project Settings**), tick **Show "appsscript.json" manifest file in editor**. Back in the editor, open `appsscript.json` and replace everything in it with the contents of `apps-script/appsscript.json`, copied the same way. Press Cmd+S.
4. **Adjust for your trip.** Near the top of `Code.gs`:
   - `HOME: 'Wellington'` and `HOME_TZ: 'Pacific/Auckland'`: your home city and its [time zone name](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones).
   - `AIRPORT_TZ`: add every airport or station code you use, e.g. `CDG: 'Europe/Paris',`.
   - `PLACE_TZ`: add a line for each country or city you stay in, e.g. `[/france|paris|lyon/i, 'Europe/Paris'],`.

   The app uses these to put events in the right order across time zones. If one is missing, **Sheet check** tells you which row. Press Cmd+S.
5. **Passcodes:** Project Settings → **Script properties** → Add script property:
   - `DAN_PASSCODE`: the passcode for the traveller who **sees everything** (keep this property name, whatever your name is).
   - `ALEX_PASSCODE`: the passcode for the traveller who **gets surprises**.

   Use three or four words rather than a PIN. Click **Save script properties**.
6. **Test:** choose `testBuild` in the toolbar's function menu and click **Run**.
   - Google will say **"Google hasn't verified this app"**. This is normal for your own scripts. Click **Advanced** (small grey link, bottom left), then **Go to … (unsafe)**.
   - It should ask only to **view this spreadsheet** and **see your Google Drive files**. If it asks for anything else, `appsscript.json` didn't paste correctly. Click **Allow**.
   - The Execution log should show `Days: …, items: …, files: …` and a list of anything it couldn't read. Fix those rows and run again.
7. **Deploy:** Deploy → **New deployment** → gear → **Web app**:
   - Execute as: **Me**
   - Who has access: **Anyone** (the passcode protects the data)
   - Click **Deploy**, approve again if asked, and copy the **Web app URL** (ends in `/exec`).

---

## Step 4: Connect and publish the app

1. In your repo, open `config.js` and click the pencil to edit:
   - `SCRIPT_URL`: your web app URL from Step 3.
   - `TRIP_NAME`: shown at the top of the app.
   - `SURPRISE_NAME`: the name of the traveller who gets surprises.

   Click **Commit changes**.
2. Note: the "Note for Alex" headings in the sheet must keep that exact wording (the script looks for "Note for Alex"). Only the labels inside the app change with `SURPRISE_NAME`.
3. **Settings → Pages** → Source: **Deploy from a branch** → `main` / `(root)` → **Save**. After a minute or two the app is live at `https://<your-username>.github.io/<repo-name>/`.
4. Test on a computer: open that address and enter a passcode. The trip should appear.

---

## Step 5: Install on each iPhone

1. Open the app's address in **Safari**.
2. Tap **Share → Add to Home Screen**.
3. Open it **from the home screen icon** (not Safari; they keep separate storage) and enter the passcode.
4. Wait until the menu (•••) shows all documents saved offline, e.g. **Documents 9/9**. From then on it works with no internet.
5. On the main traveller's phone, use **Preview … view** in the menu to check the surprises look right.

---

## Keeping it running

- Edit the sheet as normal. Phones update the next time the app opens with internet.
- Check **Sheet check** in the menu after big changes.
- If you edit `Code.gs`: Deploy → Manage deployments → pencil → Version: **New version** → Deploy.
- If you edit any app file: bump `VERSION` in `sw.js`.
- See the **Troubleshooting** table in [README.md](README.md) for common problems.

## Before you share your own copy

- Your repo is public if you're on GitHub's free plan. That's fine: it holds no trip data or passcodes. But don't add booking details to it.
- If someone else wants the app, send them **this repo link**, not your sheet or your chat history, and tell them to use their own script URL.
- Don't give others write access to your repo. They could change the app your phones load.
