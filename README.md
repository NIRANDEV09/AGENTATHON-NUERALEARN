# NeuraLearn Live Visual Tutor

The local app opens to a learning home screen with three modes: fast Groq text chat, narrated animated video lessons, and the interactive AI canvas. The video mode reuses the existing Gemini lesson flow and the reference project's browser recording approach; generated lessons can be recorded to MP4 when supported or WebM otherwise.

## Run on Windows (no setup needed)

1. Extract the whole ZIP to a normal folder (not inside the ZIP preview).
2. Double-click `START.bat`.
3. The browser opens automatically at http://localhost:3003.

Nothing else is required. A copy of Node.js is included in the `runtime` folder and the interface is already built in `dist`, so there is no installer, no `npm install`, and no internet setup step. Keep the terminal window open while using NeuraLearn.

If port 3003 is already taken, the launcher automatically uses 3006-3010 instead and prints the address it picked. If NeuraLearn is already running, it just opens the existing copy.

Everything the launcher does is written to `server-launch.log`, so if a start ever fails the reason is in that file.

## API keys

API keys live in `.env` next to `server.js` and ship with this copy, so anyone you share it with uses your keys and never has to add their own. The keys are read only by the local Node server and are never sent to the browser.

Note: everyone using this copy shares the same keys, so they also share the same free-tier rate limits. If several people use it at once you may see temporary "quota exhausted" or "models are busy" messages; wait a minute and retry. Never post this ZIP publicly, because the keys inside can be extracted and abused. Delete `.env` before publishing it anywhere, and rotate the keys if the ZIP leaks.

## The app

The app runs at http://localhost:3003. The embedded video tutor runs on port 3005. Text Chat uses Groq (`GROQ_CHAT_MODEL`, default `openai/gpt-oss-20b`). AI Video Explainer uses the ZIP project's Gemini tutor. AI Canvas uses the main lesson service.

## Developing

If you change the interface, rebuild it with `npm run build` (needs Node.js 20.19+ or 22.12+ and `npm ci` once). The launcher only rebuilds automatically when `dist` is missing.

## PDF & Files mode (merged)

The PDF & Files mode is integrated with the refined whiteboard tutor. It supports PDF/image upload, document viewing and page navigation, topic extraction, and handing a selected document topic to the whiteboard. The document remains parked while the whiteboard lesson is open; use **Back to document** to return to the same document and page.

### First-time setup

1. Copy `.env.example` to `.env`.
2. Add your own `GEMINI_API_KEY` and `GROQ_API_KEY` values to `.env`.
3. Run `npm install` once, then `npm start` (or use `START.bat` on Windows).

The archive intentionally does not include a `.env` file or API keys. Your existing keys should be added locally after extraction.
