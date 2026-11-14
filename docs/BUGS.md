# Known issues

Issues 1 to 3 were FIXED on 2026-09-16 and issue 4 on 2026-10-28; the reports are kept for the reasoning.

Found 2026-09-02 while driving the portal from a headless Claude Code session inside an
AE panel (AE 2026, 76-comp project). Each was hit by an agent doing real work, so the
"how it surfaced" notes are what a caller actually does, not a synthetic test.

---

## 1. `set_active_comp` rejects `{ id: N }` addressing — ✅ FIXED 2026-09-16

**Fix:** `handlers.set_active_comp` (`extension/host/actions.jsx`) called `compByNameOrId`,
which only accepts a name string or a numeric id, so the object form reached the string
concat in the error path and threw a type error. Now calls `resolveComp`, which has handled
`{ id: N }` since the stable-id sweep. This was the one comp-addressed handler that sweep
missed. Verified live on AE 2026 (26.3x87) against a 76-comp project: `{id:39288}` resolved,
name addressing unchanged, and a bogus id now returns `comp not found by id: 999999` instead
of an ExtendScript type error.

**Severity when open:** real. The schema documented stable-id addressing; the implementation didn't handle it.

```
set_active_comp { instance: "26", comp: { id: 11757 } }
  -> Error: Object of type Object found where a Number, Array, or Property is needed (line 482)

set_active_comp { instance: "26", comp: "Comp 1" }
  -> { "name": "Comp 1", "id": 11757 }          // works
```

The param schema is `oneOf: [string, { id: integer }]`, same as every other comp-addressed
tool, and `get_project_map` / `apply_effect` / `set_property` all accept `{id}` fine on the
same comp. Only `set_active_comp` unwraps it wrong — it looks like the object is passed
straight to an AE API expecting a number/Property around line 482.

This matters more than it looks: `{id}` addressing is the *documented* way to be safe against
duplicate comp names, and this project has many (7× `IMG_01`, 7× `Txt_01`, 3× `NL_List_B1`,
2× `Follow_B_16x9`). Falling back to name addressing here is exactly the ambiguity `{id}`
exists to avoid.

---

## 2. `lookup_property` returns `count` that looks like a match count — ✅ FIXED 2026-09-16

**Fix:** `count` is now `results.length` in all three lookups (`lookupEffect`,
`lookupProperty`, `lookupExpression` in `mcp-server/knowledge.js`, via a shared
`withCounts`), with corpus size still reported as `corpusSize` so a caller can tell
"nothing matched" from "nothing loaded". The `lookup_property` description no longer
claims effect coverage and now points at `apply_effect`'s `properties` arg or a dotted
display path. Verified offline: `4-Color Gradient` returns `{count:0, corpusSize:108}`,
`Position` returns `{count:5, corpusSize:108}`.

**Severity when open:** minor, but it reliably misled callers.

```
lookup_property { query: "4-Color Gradient", limit: 5 }
  -> { "count": 108, "query": "4-Color Gradient", "results": [] }
```

`count: 108` is the **corpus size** (the tool description says "108 properties"), not the number
of matches. A caller — human or agent — reads `count: 108` alongside `results: []` as a
contradiction and assumes the tool broke. Suggest either renaming to `corpusSize` / adding
`matched: 0`, or making `count` mean `results.length`.

Underneath it is a coverage gap: the 108-property corpus covers transforms, masks, layer
styles, text, shapes and 3D extrusion, but not per-effect property names — so no effect
lookup like this can succeed. Worth saying so in the description ("does not cover individual
effect parameters — use `apply_effect`'s `properties` or dotted display paths").

For the record, the dotted display path works fine and is what to point people at:

```
set_property { prop: "Effects.4-Color Gradient.Point 1", value: [540, 0] }   // OK
set_property_batch  ->  { "total": 7, "ok": 7, "failed": 0 }                 // OK
```

---

---

## 3. `userPresetDirs()` never returned anything, on either platform — ✅ FIXED 2026-09-16

**Severity:** real but silent. `list_installed_scripts` simply had no `User.Presets`
entries and nobody noticed, because an empty section looks like "no presets installed".

Found while verifying the Windows panel fixes on a Windows test machine: 106 items came
back with `AE.Scripts` / `AE.ScriptUI Panels` / `AE.Startup` all correct, and zero
`User.Presets`. Two independent causes, both in `extension/client/main.js`:

1. The name filter was `/^Adobe After Effects /`, but the folders are named
   `After Effects 2026` with no `Adobe ` prefix. Verified on macOS: four AE folders
   under `~/Documents/Adobe/` have a `User Presets` child and **none** match that
   regex. So this half was broken on macOS as well as Windows.
2. The base was `path.join(os.homedir(), 'Documents', 'Adobe')`. On Windows, Documents
   is routinely redirected into OneDrive and localized. On a pt-BR test machine the real path is
   `C:\Users\<user>\OneDrive\Documentos\Adobe`, so `homedir()/Documents`
   does not exist and the function returned `[]` before the regex mattered.

**Fix:** new `docsAdobeDirs()` probes `%OneDrive%`, `%OneDriveConsumer%`,
`%OneDriveCommercial%` and the home dir, accepting any child matching `/^Document/i`
(Documents / Documentos / Documenti / Dokumente) — no registry shell-out, because the
panel must not fork while ExtendScript may be allocating. `userPresetDirs()` then matches
`/^(Adobe )?After Effects\b/i` and keeps the dirs that actually have `User Presets`.
Every step is a shallow readdir, so it never walks into a cloud-synced tree.

**Verified** by extracting both functions verbatim from the shipped `main.js` and running
them on each machine:
- macOS: 4 dirs (`After Effects (Beta)`, 2024, 2025, 2026), 27 preset entries total.
- Windows: 4 dirs under `OneDrive\Documentos\Adobe` (2023, 2024, 2025, 2026).

⚠ Lives in the panel client, so it only takes effect on a panel close/reopen, not
`reload_host`.

## 4. Host lost after AE start, every call "JSX returned no value" — ✅ FIXED 2026-10-28 (Mark)

**Seen:** AE 2026 (26.5x89), Mark 0.3.0, AE restarted twice by script (20:08 and 20:15). The
second time the panel opened and the MCP server saw the instance, but every `ping` and
`run_jsx` returned `JSX returned no value (host not loaded?). Try reload_host.` and
`list_instances` showed `hostResponsive: false` for minutes. AE was idle, no dialog open. One
`reload_host` fixed it at once (`evalFileResult: "ok:0.3.0"`).

**Cause found:** the host loaded and was then lost; it was not a failed `ScriptPath` load. The
panel's own log (read over the CEP debug port, 8093) shows it:

```
20:15:15 panel loaded, node 17.7.2
20:15:16 host alive, AE 26.5x89                 <- boot ping answered, AEPortal was there
20:15:16 auto-map failed: JSX returned no value  <- same second, AEPortal already gone
20:19:12 ✗ run_jsx: JSX returned no value ...
20:21:22 ← reload_host                           <- fixed by hand
```

The discovery file agrees: written at 20:15:16 with `aeVersion` filled in, which only happens
after a successful ping. In AE every CEP panel shares one ExtendScript engine (`$.engineName`
is `"main"`), and Mark, OverlordTwo and Kease all initialised at 20:15:14; something in that
start-up wiped Mark's global. Which panel (or AE itself) did it is not known. A missing global
is also why the error was "no value": in AE 26.5 `evalScript` returns `""` (not
`"EvalScript error."`) for a ReferenceError such as `AEPortal.dispatch(...)` with no `AEPortal`.

The panel never recovered because `bootstrap()` pinged once, and `callJsxDispatch` only threw.
The live-events poller's failures were swallowed silently.

**Fix** (`client/main.js`):
- `callJsxDispatch` is now a wrapper around the old body (`dispatchOnce`). On an empty answer
  (`""`, `undefined`, `"EvalScript error."`) it probes `typeof AEPortal`. If the host is gone, the
  dispatch ran nothing, so it reloads the host and repeats the call once. If the host is there
  it does not repeat (the call may have changed the project) and passes the error on. A probe
  that times out (AE busy) never triggers a reload.
- At most one reload every 5 s, and concurrent callers share one recovery, so no loops. Each
  recovery is logged in the panel with the probe result (`host lost (method: typeof AEPortal =
  "undefined"), reloading` / `host reloaded (ok:0.3.0)`).
- `bootstrap()` retries the ping for about a minute (1, 2, 4, 8, 15, 15, 15 s) and logs each
  attempt and the ping it got back.
- A watchdog: when no dispatch has succeeded for 10 s, it runs the same check and reload. It is
  quiet while the host is healthy, because the live-events poller keeps `lastHostOkAt` fresh.

There is no file log; to read the panel log of an open panel, evaluate
`document.querySelector('#console-log').innerText` over `ws://127.0.0.1:8093` (DevTools protocol).

**Tested:** offline, by running the real code cut from `main.js` against a fake host: host gone
→ one reload and the edit runs exactly once; empty answer with the host present → no repeat; a
second loss within 5 s → no reload; two calls at once → one reload, each repeated once; probe
timeout → no reload; boot ping fails twice → retried and succeeds on the third; stale host with
no traffic → the watchdog reloads it. All passed.

In AE 2026 (26.5x89), 2026-10-28, test comp open, panel page reloaded so the new client
loaded (`boot ping 1` logged): (a) `AEPortal = undefined` and no calls: the live-events poller
hit it within a second, logged `host lost (get_quick_state ...)`, reloaded and repeated; (b)
gone again, then `ping` over MCP: reloaded, repeated, answered (`uptimeMs: 5`); (c) host
present but `dispatch` patched to return nothing for `run_jsx`: one `run_jsx` reached the
host, no reload, no repeat, error passed back; dispatch restored and `run_jsx` normal again.

⚠ Lives in the panel client, so it only takes effect on a panel close/reopen (or a reload of
the panel page), not `reload_host`. To test in AE, on an empty project: `run_jsx` with `AEPortal = undefined; "x"` (a `var` global
may not be deletable), then `ping` should come back by itself, with `host lost ... reloading`
in the panel log.

---

## Not bugs — checked, portal was right

Recording these so nobody re-investigates them.

- **`apply_effect` "layer not found"** — the caller passed `layers: "\"BG\""`, a string
  containing literal quote characters. No layer by that name exists, so the error was
  correct. *Optional* nicety: trim balanced surrounding quotes from name-addressed layers,
  since agents JSON-quote strings by accident fairly often.
- **`render_preview_strip` rejecting `frames: 1`** — schema says `minimum: 2, default: 6`,
  and the error message says so. Working as documented; the caller hadn't read the constraint.
  A contact sheet of one frame is arguably meaningless anyway.
