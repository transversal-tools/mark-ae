# Learned Templates (machine-curated)

Command sequences and `run_jsx` routines the Portal learned from **user-confirmed** results.
Kept separate from the hand-authored `operation-templates.md` so machine-added content stays
reviewable and prunable. Searchable via `knowledge_search`.

Rules for entries here (see the Self-learning block in `mcp-server/instructions.js`):
- Add an entry only after the user explicitly confirmed a specific action worked ("it works",
  "perfect", etc.) — never on a bare tool success, never after a retry/"try something else".
- Each entry: `## heading`, then a `<!-- learned YYYY-MM-DD -->` provenance marker, a one-line
  intent, then a fenced ```jsx block.
- `knowledge_search` first; update an existing entry in place rather than adding a near-copy.

---

<!-- No entries yet. The first user-confirmed reusable pattern will land here. -->
