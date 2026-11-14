# Mark

Mark lets an AI drive Adobe After Effects directly. It reads your project and makes the
changes itself (layers, keyframes, effects, expressions, text, render queue and more)
instead of handing you a script to paste.

It has two parts:

- **A panel inside After Effects** (Window > Extensions > Mark) with its own **Chat** tab, so
  you can talk to Claude without leaving AE, plus **Recipes** (save something that worked and
  re-run it from a button, with no AI and no tokens), a **Log** of every call, and a **Bridge**
  tab with the connection status.
- **An MCP server** that gives Claude Code, Codex or any other MCP client about 135 After
  Effects tools. Full list: [docs/TOOLS.md](docs/TOOLS.md).

Mark is built on **AE Portal** by **Ricardo G. Mendes / SphereLab** (MIT). Everything
AE Portal does still works the same; Mark adds the chat, recipes, memory, the log and a few
fixes. Both panels can be open in the same AE at once: they use different ports and names.

Plain Node with zero npm dependencies. Everything runs on your machine.

## Requirements

- After Effects 2022 (22.0) or newer. Tested on 2025 and 2026.
- [Node.js](https://nodejs.org) 18 or newer.
- For the Chat tab: [Claude Code](https://claude.com/claude-code), installed and signed in
  once. The chat runs it in the background.
- macOS or Windows.

## Install on macOS

1. Download Mark and keep it somewhere **permanent** (the installer links AE to this folder, so
   moving or deleting it later breaks the panel):

   ```bash
   git clone https://github.com/transversal-tools/mark-ae.git ~/mark-ae
   cd ~/mark-ae
   ```

   Or download the zip from [Releases](https://github.com/transversal-tools/mark-ae/releases)
   and unzip it, then `cd` into the folder in Terminal.

2. Run the installer:

   ```bash
   ./install-mac.sh
   ```

   It turns on CEP debug mode for AE (`PlayerDebugMode`, needed because Mark is not a signed
   .zxp), links the folder into
   `~/Library/Application Support/Adobe/CEP/extensions/Mark`, and registers the MCP server
   with Claude Code if it finds it. It is safe to run again.

3. Restart After Effects and open **Window > Extensions > Mark**.

<details>
<summary>Manual steps (what the installer does)</summary>

```bash
for v in 9 10 11 12 13; do defaults write com.adobe.CSXS.$v PlayerDebugMode 1; done
mkdir -p ~/Library/Application\ Support/Adobe/CEP/extensions
ln -s "$PWD" ~/Library/Application\ Support/Adobe/CEP/extensions/Mark
claude mcp add -s user mark -- "$(command -v node)" "$PWD/mcp-server/server.js"
```

</details>

## Install on Windows

1. Install Node (and Claude Code, for the Chat tab) in PowerShell as your normal user, then
   close and reopen PowerShell and run `claude` once to sign in:

   ```powershell
   winget install OpenJS.NodeJS.LTS
   irm https://claude.ai/install.ps1 | iex
   ```

2. Download Mark and keep it somewhere **permanent**, for example:

   ```powershell
   git clone https://github.com/transversal-tools/mark-ae.git "$env:USERPROFILE\mark-ae"
   cd "$env:USERPROFILE\mark-ae"
   ```

   Or download the zip from [Releases](https://github.com/transversal-tools/mark-ae/releases)
   and unzip it there. If Windows asks, right-click the zip > Properties > **Unblock** before
   unzipping.

3. Double-click **`install-windows.cmd`** in the Mark folder (as your normal user, **not** as
   administrator). Or run it from PowerShell:

   ```powershell
   powershell -ExecutionPolicy Bypass -File install-windows.ps1
   ```

   It turns on CEP debug mode in the registry (`HKCU\Software\Adobe\CSXS.<n>`), creates a
   junction at `%APPDATA%\Adobe\CEP\extensions\Mark` pointing to the folder, and registers the
   MCP server with Claude Code if it finds it. It is safe to run again.

4. Restart After Effects and open **Window > Extensions > Mark**.

<details>
<summary>Manual steps (what the installer does)</summary>

```powershell
foreach ($v in 9..13) {
  New-Item -Path "HKCU:\Software\Adobe\CSXS.$v" -Force | Out-Null
  Set-ItemProperty -Path "HKCU:\Software\Adobe\CSXS.$v" -Name PlayerDebugMode -Value "1"
}
New-Item -ItemType Junction -Path "$env:APPDATA\Adobe\CEP\extensions\Mark" -Target "$PWD"
claude mcp add -s user mark -- node "$PWD\mcp-server\server.js"
```

</details>

## The Chat tab and your API key

The chat uses the Claude Code installed on your computer. Click the model button inside the text
box to choose how it pays:

- **Subscription**: uses the Claude account you signed in to Claude Code with. Nothing else to
  set up.
- **API credits**: paste an Anthropic API key (`sk-ant-...`, from
  [console.anthropic.com](https://console.anthropic.com)) and click **Save**. On macOS it is
  stored in the Keychain (item "Mark - Anthropic API key"); on Windows it is stored in a file
  encrypted with your Windows login (DPAPI). It is only passed to the chat's own Claude Code
  process, and **Delete key** removes it.

The same menu picks the model (Opus, Sonnet, Haiku) and the effort. The footer shows what the day
has cost, as reported by Claude Code.

In the chat, Claude can only use Mark's tools, and scripts that write, delete, rename or run
files are refused. This is a guard, not a full sandbox.

## Use Mark from Claude Code or Codex

The panel has to be open in AE for any client to reach it. The connection dot in the Bridge tab
turns green when a client is connected.

**Claude Code** (the installers already do this):

```bash
claude mcp add -s user mark -- node /absolute/path/to/mark-ae/mcp-server/server.js
```

**Codex**: add to `~/.codex/config.toml` (the installers print this block with your paths):

```toml
[mcp_servers.mark]
command = "node"
args = ["/absolute/path/to/mark-ae/mcp-server/server.js"]
```

On Windows use forward slashes in the path, for example `C:/Users/you/mark-ae/mcp-server/server.js`.

**Claude Desktop** and other MCP clients: run `node /absolute/path/to/mark-ae/mcp-server/server.js`
over stdio, with the server named `mark`.

First check, from your client: call `ping` (expect `pong` and your AE version), then
`get_project_map` with `mode: "light"`.

Two things depend on the client: `render_frame` and `render_preview_strip` return images, so the
client has to pass image results to the model; and the server sends its usage guide in the
`instructions` field of `initialize`. If your client ignores that field, paste
`mcp-server/instructions.js` into your `AGENTS.md`.

**More than one AE at once** (for example 2025 and 2026): call `list_instances`, then pass
`instance: "2026"` on each call, or call `use_instance` once. With two connected, Mark refuses to
guess. Only one AE per major version is supported.

## Update

`git pull` in the Mark folder (or replace it with a new zip in the same place), then click **↻** in
the panel. Changes to `CSXS/manifest.xml` need an AE restart.

## Where your data lives

- Recipes, memory and daily cost: `~/Library/Application Support/Mark` on macOS,
  `%APPDATA%\Mark` on Windows.
- Lessons from Learning mode: `knowledge/learned-templates.md` in the Mark folder.
- Backup: a copy of those files (latest, plus one per day for 30 days) in the data folder's
  `Backup` subfolder. To put it somewhere else, such as a synced folder, write that folder's
  absolute path on the first line of `backup-dir.txt` in the data folder.

## Security

- The panel and the MCP server talk only over `127.0.0.1`, with a token the panel generates.
  Nothing is exposed to the network.
- `run_jsx` runs any ExtendScript. Connect only clients you trust.
- No telemetry, no licence check, no remote code.

## Troubleshooting

- **The panel is not in Window > Extensions**: run the installer again, check that
  `PlayerDebugMode` is `1`, and that the `Mark` link in the CEP extensions folder points to this
  folder. Restart AE.
- **"panel is not connected"**: open Window > Extensions > Mark. The server reconnects on its own.
- **Node not found by your client**: use the absolute path from `command -v node` (macOS) or
  `(Get-Command node).Source` (Windows) instead of `node`.
- **Opening a project through Mark closes the panel** in some AE versions. Reopen it, or open
  projects yourself.
- `undo` can report success and change nothing. Re-read the state to check.

Known issues and their history: [docs/BUGS.md](docs/BUGS.md).

## What After Effects cannot script

These are limits of AE's scripting API, so no tool can do them: Roto Brush and paint strokes,
`CUSTOM_VALUE` effect parameters (Curves, Colorama gradients), Output Module codec settings
(apply a saved template instead), starting a motion or camera track, grid settings, per-footage
color profiles, and reading the Essential Graphics panel.

## License

MIT. See [LICENSE](LICENSE). Original AE Portal © 2026 Ricardo G. Mendes / SphereLab.
