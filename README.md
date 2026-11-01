# NeuraLearn Live Visual Tutor

The local app opens to a learning home screen with five modes: fast Groq text chat, narrated animated video lessons, the interactive AI canvas, PDF & Files for grounded document lessons, and Read Screen for desktop-wide marked-region explanations. The video mode reuses the existing Gemini lesson flow and the reference project's browser recording approach; generated lessons can be recorded to MP4 when supported or WebM otherwise.

## Run on Windows (no setup needed)

1. Extract the whole ZIP to a normal folder (not inside the ZIP preview).
2. Double-click `START.bat`.
3. The browser opens automatically at http://localhost:3003.

A copy of Node.js is included in the `runtime` folder and the interface is already built in `dist`, so there is no installer or `npm install` needed. Keep the terminal window open while using NeuraLearn.

If port 3003 is already taken, the launcher automatically uses 3006-3010 instead and prints the address it picked. If NeuraLearn is already running, it just opens the existing copy.

Everything the launcher does is written to `server-launch.log`, so if a start ever fails the reason is in that file.

## Sharing the ZIP with someone else

The ZIP does not contain your private `.env` file or API keys. The app starts without them, but AI lesson generation, PDF topic analysis, and Gemini narration need the other person to add their own Gemini key: copy `.env.example` to `.env`, open `.env` in a text editor, and replace `PASTE_YOUR_GEMINI_API_KEY_HERE` with their key. They can add their own Groq key in the same file if they want Groq text chat. Save the file and restart `START.bat`. Do not send your personal `.env` file to anyone.

If Gemini narration is unavailable, the video tutor falls back to voices installed on that laptop, including ordinary system voices. Voice availability differs between computers.

The movable Read Screen window is a Windows-only feature. On macOS or Linux, use **Share screen** in the browser page instead. On Windows, extract the ZIP to a normal folder and run `START.bat`; if the floating window fails to start, the page reports the reason and you can use browser screen sharing as a fallback. Screen sharing must be opened from the local website, not from a ZIP preview or a `file://` page.

## API keys

Copy `.env.example` to `.env` and add your own Gemini and Groq API keys. Keys stay in the local server configuration and are not sent to the browser. Never share or publish `.env`; use `.env.example` with placeholders when sharing the project.

## The app

The app runs at http://localhost:3003. The embedded video tutor runs on port 3005. Text Chat uses Groq (`GROQ_CHAT_MODEL`, default `openai/gpt-oss-20b`). AI Video Explainer uses the ZIP project's Gemini tutor. AI Canvas uses the main lesson service. Read Screen opens a small always-on-top Windows window that you can move and resize. Choose “Select an area anywhere on screen” to briefly show a transparent marking layer over any app; click a point or drag around a region. After the selected still image is read, choose Text Chat, Video Explainer, or Canvas Tutor to continue that explanation in the corresponding existing NeuraLearn mode. Browser screen sharing remains available as a fallback.

### Learn from a complete PDF or slide deck

In AI Video Explainer, attach a PDF or `.pptx` file (up to 40 MB). NeuraLearn splits the extracted content into ordered, bounded sections, starts generating visual lessons as soon as extraction is ready, and builds the document overview in the background from every section. Long files are never sent to a single oversized model request. Scanned or sparse PDF pages are OCRed individually; PowerPoint slide text, speaker notes, image descriptions, and embedded slide images are read with AI. Slide images and OCR require a configured Gemini key and can take longer for large files. Legacy `.ppt` files are not supported; convert them to `.pptx` first.


### PDF & Files Tutor

Choose **PDF & Files** from the home screen to upload a PDF or image, browse pages, select a passage or diagram, and get suggested topics. Choosing a topic carries its source page context into AI Canvas to create a visual lesson. PDF rendering happens in the browser; topic analysis and AI lesson generation require a Gemini API key.
## Developing

If you change the interface, rebuild it with `npm run build` (needs Node.js 20.19+ or 22.12+ and `npm ci` once). The launcher only rebuilds automatically when `dist` is missing.
