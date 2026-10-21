# ibm-networking-search-ai

Personal internal IBM search tool. Intended use is for internal IBM employees (specifically new hires) to find other IBM employees that might interest them (similar career paths, managers, etc.).

Today the app does directory search, org chart browsing, an AI summary of one person's resume, and a profile page that suggests people to contact.

## Setup and running

You need Python 3.10–3.14, Node.js 20.19+ (or 22.12+), and access to the IBM network. Ports 8000 and 5180 must be free.

### 1. Set the ICA API key (optional)

Without a key, search, profiles and the org chart work. Resume summaries and suggestions do not.

1. Go to ICA and get a personal developer key for ICA.
2. Open `backend/.env` (`start.bat` creates it on first run; otherwise copy `backend/.env.example`).
3. Set `ICA_API_KEY=your-key-here`. No quotes, no spaces around `=`.
4. Restart the app. Settings are read once at startup.

Never commit the key. `backend/.env` is git-ignored.

### 2. Start the app

**Windows:** run `start.bat` from the repo root. It sets everything up on first run (a few minutes), opens a Backend window and a Frontend window, then opens `http://localhost:5180`. Close both windows to stop.

**Any OS:** use two terminals.

```
# Terminal 1 (backend)
cd backend
python -m venv .venv
.venv\Scripts\activate.bat      # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env            # Windows cmd: copy .env.example .env
uvicorn app.main:app --port 8000

# Terminal 2 (frontend)
cd frontend
npm install
npm run dev
```

Then open `http://localhost:5180`.

## What it does

- **Search** by name and/or job title.
- **Profile** with photo, contact details, location and an org chart.
- **Resume summary** (only some people have a resume on file), checked by a second AI model and given a score.
- **My profile** (`/profile`): your own profile plus a row of people you might want to reach out to.
- Light and dark themes.

There is no login. The "Who are you?" choice is saved in this browser only and is not security.

## Data handling

The app uses real IBM employee data. Do not commit captured responses or fixtures containing real names or emails.