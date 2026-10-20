# Drive Reel

A Claude MCP server that turns a Google Drive folder of footage into a themed, edited video, then publishes it to a website where anyone can watch it, and edit and re-render it.

```
You → Claude: "Make a 45s aftermovie for VinHack 2026 from <drive link>"
Claude → analyze_drive_folder   downloads, watches and measures every clip; returns contact sheets Claude can see
Claude → propose_themes         3–4 themes, each a different story with hand-picked shots, plus a preview frame each; you pick one
Claude → generate_video         beat-synced edit → 1080p MP4 → published with an editor
Claude → "Watch: https://…/v/abc123 · Edit: https://…/v/abc123/edit?key=…"
```

## How it works

| Stage | What happens | Code |
|---|---|---|
| Read Drive | Lists the shared folder (no API key needed; optional key for big folders and shortcuts), retries Drive's rate limits, samples up to 24 clips and 24 photos evenly across sub-folders, de-duplicates re-uploads (same name *and* size) and burst shots, converts HEIC/RAW photos through Drive's thumbnail service | `mcp/drive.ts`, `mcp/analyze.ts` |
| Understand footage | 1080p proxies (HDR iPhone footage tonemapped; long recordings sampled as segments across their whole length), per-half-second loudness, motion, brightness and sharpness (dark or smeared moments are avoided), in-clip hard cuts, best moments, an 8-frame contact sheet per clip that Claude looks at, tempo and first beat of any song in the folder | `mcp/analyze.ts`, `mcp/media.ts`, `mcp/beats.ts` |
| Themes | Claude notes what each clip shows, then writes 3–4 themes on 7 style presets (cinematic, hype, nostalgic, elegant, playful, clean, neon). Each has its own story arc and a hand-picked shot list (opener, peak, closer) with captions; the tool rejects themes that tell the same story and returns a rendered preview frame per theme | `mcp/server.ts`, `shared/styles.ts` |
| Edit | Claude's shots anchor the story; the gaps are filled with the best remaining windows (energy vs calm depending on style), round-robin across clips. Every shot is a whole number of beats and every cut (transition midpoint) sits within a frame of the soundtrack's beat grid; the outro absorbs the remainder so the length is exact. No shot spans a cut inside its clip | `mcp/planner.ts` |
| Music | Uses an audio file from the folder, or synthesises a royalty-free track matched to the style's tempo, key and drums | `mcp/music.ts` |
| Render | One JSON **edit plan** → Remotion composition (titles, grades, grain, letterbox, transitions, Ken Burns photos, portrait clips on a blurred fill, captions) → H.264 MP4, loudness-normalised to −14 LUFS | `shared/plan.ts`, `remotion/`, `render/` |
| Publish | Uploads the MP4, poster, plan and *all* analysed media plus a manifest (so the editor can swap in clips the first cut didn't use); the site returns a private edit key | `mcp/publish.ts`, `src/app/api/videos` |
| Edit on the web | CapCut-style editor: live preview of the same composition, timeline with playhead, media bin (add or replace clips and photos), text cards, reorder/trim/speed/caption per shot, style/colour/frame/transition for the whole video, soundtrack picker and song upload, undo/redo, export as a new version (renders are queued, one at a time). Only someone with the edit link can change a video | `src/app/v/[id]/edit` |

The edit plan is the single source of truth: the MCP server writes it, the renderer renders it, and the editor changes it and renders it again. That's what makes the website editor cheap: it edits JSON, not pixels.

**Fallback route:** `create_motion_graphics_video` makes a footage-free, launch-film-style video (e.g. a StudyHub promo) from scenes Claude writes after reading the product's link: kinetic headlines, feature icons, animated stats, product screenshots in device frames, quotes, bullets revealed on the beat.

## Run it

Needs Node 22+. ffmpeg and Chrome Headless Shell are downloaded automatically.

```bash
npm install
cp .env.example .env      # set PUBLISH_TOKEN to any random string
npm run dev               # website on http://localhost:3000
```

### Connect it to Claude

**Claude Code:** this repo ships a `.mcp.json`; open the folder in Claude Code and approve the `drive-reel` server.

**Claude Desktop:** add this to `claude_desktop_config.json` (use your own path), then restart Claude:

```json
{
  "mcpServers": {
    "drive-reel": {
      "command": "node",
      "args": ["C:/path/to/drive-reel-mcp/node_modules/tsx/dist/cli.mjs", "C:/path/to/drive-reel-mcp/mcp/server.ts"]
    }
  }
}
```

Then say: *"Make a 45-second aftermovie for VinHack 2026 from this Drive folder: …"*. The folder must be shared as **Anyone with the link → Viewer**.

For development you can point it at a folder on disk instead of Drive by setting `ALLOW_LOCAL_SOURCES=1`; leave it unset anywhere else.

### Tools

| Tool | Purpose |
|---|---|
| `analyze_drive_folder` | Download + analyse footage; returns stats and contact sheets (long runs return a job id) |
| `check_job` | Wait for / fetch a running analysis or render |
| `view_clips` | More contact sheets on demand |
| `propose_themes` | Save 3–4 themes for the user to choose from |
| `generate_video` | Render the chosen theme and publish it (optional tweaks and length override) |
| `create_motion_graphics_video` | Footage-free fallback route |
| `get_project` | Inputs, themes and published links for a project |

There is also a `make_video` prompt (slash command) that starts the whole flow.

## Tests

```bash
npm test                                    # unit tests: timeline maths, beat grid, tempo detection, Drive parsing, sampling, planner, path safety
npx tsx tests/e2e-client.ts <drive link>    # full MCP flow against a real folder (site must be running)
npx tsx tests/e2e-motion.ts                 # motion-graphics route
```

## Hosting

Rendering needs Chrome and ffmpeg running for minutes, so the site needs a real server rather than serverless functions:

- **Free, fastest:** run `npm run build && npm start` on your machine and expose it with a Cloudflare Tunnel on your domain.
- **Always on:** deploy the `Dockerfile` to Railway / Fly.io / Render with a volume mounted at `/app/data`.

Set `SITE_URL` in the MCP server's `.env` to the public URL so Claude hands out the right links.

## Notes

- Remotion is free for individuals and companies of up to 3 people; larger companies need a Remotion company licence.
- Google Drive rate-limits anonymous downloads of very large folders; requests are retried with backoff, and setting `GOOGLE_API_KEY` (Drive API enabled) makes listing more reliable (pagination, shortcuts, exact sizes for de-duplication).
- Edit links carry a per-video key. Anyone with the watch link can watch; only the edit link can change or re-render a video.
