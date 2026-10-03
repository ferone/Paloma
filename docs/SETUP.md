# Real Assets Dashboard: installation and operation guide

This guide is for the fund's operator. The dashboard runs **entirely on one Windows machine**: a local server plus a browser tab. The server only listens on this computer (`127.0.0.1`); it is not reachable from the network.

---

## 1. Requirements

| Component | Version | Notes |
|---|---|---|
| Windows | 10 or 11, 64-bit | |
| Node.js | **22** | Install with [nvm-windows](https://github.com/coreybutler/nvm-windows/releases): `nvm install 22` then `nvm use 22`. |
| Python | 3.11 or newer (3.13 recommended) | [python.org](https://www.python.org/downloads/). Tick "Add python.exe to PATH". Needed only for the machine-learning section. |
| NVIDIA GPU | Optional | Speeds up part of ML training. Everything works on the CPU without one. |
| Disk | About 2 GB | Code, dependencies, the market-data database and models. |

---

## 2. Install

Open **PowerShell** in the folder that holds the dashboard (the folder containing `package.json`).

```powershell
# 1. JavaScript dependencies
npm ci

# 2. Machine-learning environment (a private Python environment inside ml\.venv,
#    picked up automatically by the dashboard)
py -3 -m venv ml\.venv
ml\.venv\Scripts\python -m pip install --upgrade pip
ml\.venv\Scripts\python -m pip install -r ml\requirements.txt

# 3. Optional, NVIDIA GPU only: replace the CPU build of PyTorch with a CUDA build
ml\.venv\Scripts\python -m pip install torch --index-url https://download.pytorch.org/whl/cu128 --force-reinstall
```

Check the ML environment with `npm run ml:test`, which should end with "passed".

> **After changing Node versions** (e.g. upgrading Node), run `npm rebuild better-sqlite3` once.

---

## 3. First start

1. Double-click **`Start Real Assets Dashboard.cmd`**, or run `npm start` in PowerShell.
   - The first start builds the dashboard, which takes about 30 seconds. Later starts are immediate.
   - Your browser opens **http://localhost:3100**.
   - **Keep that window open** while you use the dashboard; closing it stops the server.
2. Go to **Settings** and set up the **admin PIN** the first time you change anything. The PIN protects API keys and settings from anyone else using this computer.
   - It is stored only as a salted hash. If you forget it, run `npm run admin:reset-pin` and choose a new one; saved keys are kept.
3. In **Settings → API keys**, add the keys and press **Test first**, then **Save**. Keys are encrypted on this machine, and the browser only ever shows the last four characters.

| Key | Needed for | Where to get it | Cost |
|---|---|---|---|
| **Databento** | Futures history (spreads, butterflies, seasonality, open interest) | databento.com → Portal → API keys | Pay per download. Every pull is estimated for free first and capped (Settings → Data spend guard). |
| **OpenRouter** | AI Analyst briefs and the on-page assistant | openrouter.ai → Keys | Pay per use. A monthly cap is set in Settings → Assistant. |
| FRED (optional) | Macro series | fred.stlouisfed.org → API key | Free |
| CFTC (optional) | Commitments of Traders positioning; raises the rate limit | publicreporting.cftc.gov → Developer settings → create an App Token. Leave "Callback Prefix" empty and copy the **App Token**, not the secret. | Free |

---

## 4. Market data

**Option A: start from the delivered database (recommended).** Copy the delivered `data\gold.db` into the `data\` folder *before* the first start. It already contains:
- the full futures history: gold, silver, copper, platinum and palladium from 2010, bitcoin from 2017, and the micro contracts;
- open-interest history;
- the macro, COT and ETF history;
- the trained models.

Keys saved on another machine do not travel: they are encrypted with that machine's key file. Enter your own keys in Settings.

**Option B: download it yourself.** In **Data Center → Databento**, press **Estimate** (free), then backfill:
- **History:** about $8 for prices and about $7 for open interest across all products, at the time of writing.
- **Yahoo, FRED and CFTC data:** free. They load with **Data Center → Jobs → Run**.

**Keeping data current:** the **daily scheduler** is on by default.
- It runs on weekdays at 22:30 UTC, after the CME close: prices, macro and COT, the Databento incremental pull, the quant engine, ML scoring and the NAV snapshot.
- The Databento part is capped at $1 per day.
- Change or disable it in **Settings → Daily refresh**. It runs only while the dashboard server is running.

---

## 5. Daily use

| Area | What it does |
|---|---|
| Overview | NAV, allocation, markets strip, top opportunities, macro regime, ML signal |
| Portfolio | Ledger (manual entry or CSV import), holdings with FIFO lots, performance and risk, physical vault |
| Investor report | Printable factsheet (Ctrl+P → Save as PDF) |
| Markets | Prices, term structure, ETFs, technicals, comparison, liquidity |
| Quant Lab | Scanner (QT rank, tiers, verdicts), spreads and flies, seasonality, relative value, backtests |
| Macro & AI | Macro dashboard, positioning, correlations, AI Analyst (reports saved per asset with date and model) |
| Intelligence | 20-day direction models per asset, with walk-forward validation. A model is used only if it passes every check. |
| Data Center | Downloads (CSV/JSON), Databento, job status |

- **The assistant** is available on every page through the "Ask" button or **Ctrl+J**. It knows what is on screen and explains the platform's terms and rules.
- **Training a model:** Intelligence → **Train**. It takes about 5–12 minutes per asset on the full history since 2001. **Settings → ML compute** chooses Auto (recommended), GPU or CPU.

---

## 6. Start automatically with Windows (optional)

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-startup.ps1          # install
powershell -ExecutionPolicy Bypass -File scripts\install-startup.ps1 -Remove  # remove
```

- The server then starts at logon, without opening a browser. Open **http://localhost:3100** when you need it; the log is in `data\server.log`.
- Don't also double-click the start file while the startup task is running: both use port 3100.

---

## 7. Backup and restore

Back up these **two files together**, ideally daily:

| File | Contains |
|---|---|
| `data\gold.db` (plus `gold.db-wal` if present) | Ledger, prices, reports, models, encrypted keys, settings |
| `data\secret.key` | The machine key that decrypts the saved API keys |

- **Best practice:** stop the server (close its window) before copying, so the database is consistent.
- **If `secret.key` is lost:** everything except the saved API keys is fine. Settings shows "Re-enter key", and you enter the keys again.
- **Restore:** stop the server, put both files back in `data\`, and start again.

---

## 8. Updating to a new version

1. Stop the server.
2. Replace the program files, keeping your `data\` folder (or `git pull`).
3. Run `npm ci`.
4. If `ml\requirements.txt` changed, run `ml\.venv\Scripts\python -m pip install -r ml\requirements.txt`.
5. Start again. The dashboard rebuilds itself when the source changed, and database migrations apply automatically.

An open browser tab reloads itself once if it was showing the old version.

---

## 9. Troubleshooting

| Symptom | Fix |
|---|---|
| Page does not load | The server window must be open. Use **http://localhost:3100**, or 5173 in developer mode. |
| "Port 3100 already in use" | Another copy is running (perhaps the startup task). Close it, or start on another port with `set PORT=3200 && npm start`. |
| A key test fails | Re-paste the key without spaces, and check the provider account has credit. |
| Intelligence says Python is unavailable | Install step 2. Or point to an interpreter with `setx ML_PYTHON "C:\path\to\python.exe"`, then restart. |
| GPU not detected (Settings → ML compute) | Install the CUDA build of PyTorch (step 2.3) and update the NVIDIA driver. Auto mode falls back to the CPU anyway. |
| Errors mentioning `better-sqlite3` after a Node change | `npm rebuild better-sqlite3` |
| Forgot the admin PIN | `npm run admin:reset-pin` |
| "Integration not configured" | Add the key in Settings → API keys. It takes effect immediately, with no restart. |

---

## 10. Security notes

- **Local only:** the server listens only on this computer. The browser reaches it at `localhost`.
- **Keys:** encrypted at rest (AES-256-GCM) with `data\secret.key`. Changing keys, models, budgets and fund settings requires the admin PIN.
- **Data leaving this machine:** only the requests to Databento, OpenRouter, FRED, CFTC and Yahoo. The AI features send a compact summary of the page you are viewing, never keys.
- **AI and model output:** advisory only. It never places trades.
