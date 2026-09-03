# 🌍 EduWorld — Step Inside Anything You Want to Learn

Type any topic. An AI agent designs a living, explorable 3D world with guided
missions — rendered in real time, explored like a game.

**How it works:** a student types _"I want to understand gravity"_ → our agent
(Kimi) writes a world blueprint + missions → a real-time world model (Reactor)
renders it live → the student walks inside it with WASD and completes missions.

## ✨ Features

- 🧠 **Agent-designed lessons** — Kimi turns any topic into a world prompt + missions
- 🎮 **Two world engines** (engine-agnostic architecture):
  - **✨ Happy Oyster** — quality tier, persistent worlds ($0.83/min)
  - **⚡ LingBot World 2** — eco tier, hold-key event triggers ($0.20/min)
- ♾️ **World library** — generate once, re-enter forever (no regeneration cost)
- 🎬 **Cinematic UI** — Three.js hero, Framer Motion, playable loading screen
- 📊 **Full observability** — live terminal logs in-app + server-side timing logs

## 🛠️ Tech Stack

| Layer      | Tech                                                        |
| ---------- | ----------------------------------------------------------- |
| Framework  | Next.js 15 (App Router) + TypeScript                        |
| Agent      | Kimi (OpenAI-compatible endpoint, self-hosted or Moonshot)  |
| World models | Reactor — Happy Oyster + LingBot World 2 (`@reactor-models/*`) |
| 3D hero    | React Three Fiber + drei                                    |
| Animation  | Framer Motion                                               |
| Images     | fal.ai / Gemini / Pollinations (provider chain, free fallback) |

---

## 🚀 Setup — Step by Step

### 1. Prerequisites

- Node.js 18+ and npm

### 2. Clone & install

```bash
git clone <your-repo-url> ed-world
cd ed-world
npm install
```

### 3. Get your API keys

You need **one required key (Reactor)** + **Kimi access** + *(optional)* an
image-provider key for better seed frames.

#### 🔑 3a. Reactor API key (REQUIRED — powers the world models)

1. Go to **https://reactor.inc** and create an account
2. Open your dashboard → API keys
3. Create a key — it starts with `rk_...`
4. This goes in `.env` as `REACTOR_API_KEY`

> 💰 New accounts get free credits. Happy Oyster costs 139 credits/sec,
> LingBot World 2 costs 33 credits/sec (10,000 credits = $1).

#### 🧠 3b. Kimi (REQUIRED — the lesson-planning agent)

**Option A — self-hosted on Modal** (what we use):

1. Deploy a Kimi model on Modal with an OpenAI-compatible endpoint
   (e.g. `https://<workspace>--ep-kimi-k3-server.us-west.modal.direct/v1`)
2. Go to **https://modal.com/settings** → **API Tokens** → **New Token**
   in the **same workspace that owns the endpoint**
3. You get a Token ID (`ak_...`) and Token Secret (`as_...`)
4. Set in `.env`:
   ```
   KIMI_BASE_URL=https://<your-endpoint>/v1
   KIMI_MODAL_KEY=ak_...
   KIMI_MODAL_SECRET=as_...
   KIMI_MODEL=<model name your endpoint serves>
   ```

**Option B — Moonshot public API** (simplest):

1. Go to **https://platform.moonshot.ai** → create an API key
2. Set in `.env`:
   ```
   KIMI_BASE_URL=https://api.moonshot.ai/v1
   KIMI_API_KEY=<your moonshot key>
   KIMI_MODEL=kimi-k2-0711-preview
   ```

> ⚠️ If Modal proxy auth is on, `Authorization: Bearer` does NOT work — you
> must use `KIMI_MODAL_KEY`/`KIMI_MODAL_SECRET` (the app handles both).

#### 🖼️ 3c. Image provider (OPTIONAL — seed frames for LingBot engine)

The app tries providers in order and falls back to **free Pollinations**
(no key needed). For better quality, set ONE:

| Provider  | Where to get the key                          | Cost            |
| --------- | --------------------------------------------- | --------------- |
| `FAL_KEY` | https://fal.ai/dashboard/keys                 | ~$0.025/image   |
| `GEMINI_API_KEY` | https://aistudio.google.com/apikey     | Free tier       |

### 4. Configure `.env`

```bash
cp .env.example .env
```

Fill it in — every field is documented inside `.env.example`:

```bash
REACTOR_API_KEY=rk_...                    # required
KIMI_BASE_URL=https://api.moonshot.ai/v1  # your Kimi endpoint
KIMI_MODAL_KEY=                           # Modal auth (option A)
KIMI_MODAL_SECRET=                        # Modal auth (option A)
KIMI_API_KEY=                             # Bearer auth (option B)
KIMI_MODEL=kimi-k3                        # model name
FAL_KEY=                                  # optional
GEMINI_API_KEY=                           # optional
```

### 5. Run

```bash
npm run dev
```

Open **http://localhost:3000** 🎉

---

## 🎮 Using the App

1. **Type a topic** (or click an example) and pick an engine:
   - `✨ Oyster` — max quality, persistent worlds
   - `⚡ LingBot` — 4x cheaper, hold-key events
2. The agent designs the lesson → **Mission Briefing** appears
3. Click **Step inside →** — watch the live build log in the loading screen
4. **Controls (Oyster):** `WASD` move · `Arrows` look · `Space` jump · `Shift` sprint
5. **Controls (LingBot):** `WASD` move · `Arrows` look · `1–4` hold for events · `Space` jump
6. Worlds save to the **library** on the homepage — re-enter for free

## 📁 Project Structure

```
app/
  page.tsx                 ← student flow (home → briefing → world)
  globals.css              ← design system
  api/
    token/route.ts         ← Reactor JWT minting (server-side, key stays safe)
    plan/route.ts          ← Kimi agent (engine-aware: oyster | lingbot)
    image/route.ts         ← seed-image provider chain (fal → gemini → pollinations)
components/
  WorldExperience.tsx      ← Happy Oyster engine (quality tier)
  LingbotExperience.tsx    ← LingBot engine + live layered prompt recomposition
  LoadingUniverse.tsx      ← playable loading screen (gravity particles + live log)
  Scene.tsx                ← Three.js hero planet
lib/
  lingbot.ts               ← layered prompt harness (composePrompt engine)
  worlds.ts                ← world library (localStorage)
```

## 💸 Cost Architecture

- Worlds are **generated once, reused forever** (Happy Oyster `encrypted_world_id`)
- LingBot scenes are stored as JSON — re-staging costs nothing but stream time
- LingBot tier is **4.2x cheaper** per minute than Oyster
- Every slow step is logged with timings — check the in-app terminal + server console

---

Built with Kimi × Reactor · hackathon project 🚀
