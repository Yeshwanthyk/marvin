# review-export Implementation Plan

## Overview

Create a `/review-export` command + supporting gitgud skill that runs 3-phase code review and generates a standalone HTML document with scroll-synced context pane + precision diffs.

## Current State

### Existing Infrastructure
- **Commands** at `~/.config/marvin/commands/`:
  - `review.md` → chains review-explain → review-deep → review-verify

- **Review agents** at `~/.config/marvin/agents/`:
  - `review-explain.md` → XML: `<summary>`, `<fileOrder>` with `<file>/<filename>/<fileSummary>`
  - `review-deep.md` → XML: `<detailedReview>` with markdown + line comments (🔴🟡💡✅❓)
  - `review-verify.md` → XML: `<verification>` with `<verified>/<dismissed>/<added>` comments

- **Subagent invocation**: `subagent` tool with `chain` mode for sequential execution

- **Diff library**: `@pierre/diffs` - vanilla JS API available via CDN
  - `FileDiff` component takes `oldFile`/`newFile` or patch
  - Supports line annotations, themes, split/unified views

- **Reference**: Cerebro at `/Users/yesh/Documents/personal/reference/guck/` uses `@pierre/precision-diffs` (older name) with React

### Key Discoveries
- `@pierre/diffs` renders via Shadow DOM + CSS Grid
- Vanilla API: `const inst = new FileDiff(options); inst.render({ fileDiff, fileContainer, lineAnnotations })`
- CDN available via esm.sh
- Annotations via `lineAnnotations` array + `renderAnnotation` callback
- Commands are simple md files; skills hold complex assets/templates

## Desired End State

```
/review-export [target]
       ↓
Runs: review-explain → review-deep → review-verify
       ↓
Parses XML outputs → JSON structure
       ↓
Generates HTML:
┌─────────────────┬──────────────────────────────┐
│  CONTEXT PANE   │  DIFF PANE                   │
│  (sticky/sync)  │  (@pierre/diffs)             │
│                 │                              │
│  Summary text   │  File: auth.ts               │
│  for current    │  - old code                  │
│  visible chunk  │  + new code                  │
│                 │  [🔴 Bug annotation]         │
└─────────────────┴──────────────────────────────┘
       ↓
Opens in browser
```

**Verification:**
```bash
# Skill exists and is discoverable
gitgud show review-export

# Generated HTML:
# - Opens in browser
# - Shows diffs with syntax highlighting
# - Left pane updates on scroll
# - Comments rendered inline
```

## Out of Scope
- Interactive comment resolution (read-only export)
- Real-time updates (static document)
- Multiple export formats (HTML only)
- Custom themes (use pierre-dark)

---

## Phase 1: Command File

### Overview
Create the slash command that orchestrates the review + export flow.

### Prerequisites
- [ ] Existing review agents work

### Changes

#### 1. Create command file
**File**: `~/.config/marvin/commands/review-export.md`
**Lines**: new file

```markdown
# Review Export

Generate a shareable HTML code review document.

```
/review-export                    # Review HEAD~1 (last commit)
/review-export HEAD~3             # Review last 3 commits  
/review-export main..HEAD         # Review branch changes vs main
/review-export --staged           # Review staged changes only
```

## Process

1. **Resolve diff args** from `$ARGUMENTS`:
   - empty → use `HEAD~1` (matches `/review` default)
   - `--staged` → use `--cached`
   - otherwise → pass through as-is (e.g. `main..HEAD`, `HEAD~5`)

2. **Get patch (no ANSI)**:
   ```bash
   git diff --no-color $DIFF_ARGS
   git diff --no-color --numstat $DIFF_ARGS
   ```

3. **Repo metadata**:
   ```bash
   git rev-parse --abbrev-ref HEAD
   git rev-parse --short HEAD
   ```

4. **Run review pipeline**: Use subagent tool in chain mode:
   - review-explain → review-deep → review-verify
   - Pass the same `git diff --no-color ...` output into each phase

5. **Parse XML → write `/tmp/review.json`**:
   - Include `patch` from step 2
   - File order + file summaries from `review-explain`
   - Comments from `review-deep` (parse markdown headings)
   - Verified/dismissed/added from `review-verify`
   - Merge: drop dismissed bugs/warnings, prefer verified versions

6. **Render HTML via skill script**:
   ```bash
   SKILL_DIR=$(gitgud path review-export)
   OUT=/tmp/review-$(date +%s).html
   node "$SKILL_DIR/render.mjs" --template "$SKILL_DIR/template.html" --data /tmp/review.json --out "$OUT"
   open "$OUT"
   ```

## Data Extraction

Parse XML from review phases:

**review-explain** → `<summary>`, `<fileOrder>/<file>/<filename>/<fileSummary>`
**review-deep** → `<detailedReview>` (markdown with ### Line N: 🔴 Bug format)
**review-verify** → `<verified>/<comment>`, `<dismissed>`, `<added>`

Build JSON structure matching template's `REVIEW_DATA` format.

## Template Reference

The HTML template is in the review-export skill:
```bash
gitgud show review-export
```

Template expects `REVIEW_DATA` JSON with:
- `branch`, `commit`, `summary`
- `patch`: unified diff string (multi-file, --no-color)
- `files[]`: path, summary, oldContents/newContents (optional), comments[]
- `stats`: bugs, warnings, suggestions, good
```

### Success Criteria

**Manual:**
- [ ] `/review-export` triggers this command
- [ ] Command file is readable

---

## Phase 2: Skill with Template

### Overview
Create the gitgud skill containing the HTML template and usage docs.

### Prerequisites
- [ ] Phase 1 complete (command exists)

### Changes

#### 1. Create skill directory
```bash
mkdir -p ~/.gitgud/skills/review-export
```

#### 2. Create SKILL.md
**File**: `~/.gitgud/skills/review-export/SKILL.md`
**Lines**: new file

```markdown
---
name: review-export
description: HTML template and docs for review-export command. Contains the template for generating shareable code review documents with @pierre/diffs.
---

# Review Export Skill

This skill provides the HTML template for `/review-export` command.

## Template Location

```bash
$(gitgud path review-export)/template.html
```

## Template Variables

Replace these placeholders when generating:

| Placeholder | Value |
|-------------|-------|
| `{{BRANCH}}` | Current git branch |
| `{{COMMIT}}` | Short commit hash |
| `{{SUMMARY}}` | Review summary text |
| `{{BUG_COUNT}}` | Number of bugs |
| `{{WARNING_COUNT}}` | Number of warnings |
| `{{SUGGESTION_COUNT}}` | Number of suggestions |
| `{{GOOD_COUNT}}` | Number of compliments |
| `{{REVIEW_DATA_B64}}` | Base64-encoded JSON (UTF-8) |

## REVIEW_DATA Schema

```typescript
{
  branch: string,
  commit: string,
  summary: string,
  patch: string, // unified diff (multi-file, --no-color)
  files: [{
    path: string,
    summary: string,
    additions: number,
    deletions: number,
    comments: [{
      startLine: number,
      endLine: number,
      type: 'bug' | 'warning' | 'suggestion' | 'good',
      text: string
    }]
  }],
  stats: { bugs, warnings, suggestions, good }
}
```

## Reference

For high-quality HTML, consult:
```bash
gitgud show frontend-design
```
```

#### 3. Create template.html
**File**: `~/.gitgud/skills/review-export/template.html`
**Lines**: new file

```html
<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Code Review: {{BRANCH}} @ {{COMMIT}}</title>
  <style>
    :root {
      --bg: #161616;
      --bg-secondary: #1c1c1c;
      --bg-tertiary: #232323;
      --text: #e8e8e8;
      --text-secondary: #8c8c8c;
      --text-muted: #5c5c5c;
      --border: #2a2a2a;
      --accent: #8fb996;
      --bug: #d68980;
      --warning: #d6a36c;
      --suggestion: #6ca3d6;
      --good: #8fb996;
      --font-sans: system-ui, -apple-system, sans-serif;
      --font-mono: 'SF Mono', Consolas, monospace;
    }
    
    * { box-sizing: border-box; margin: 0; padding: 0; }
    
    body {
      font-family: var(--font-sans);
      background: var(--bg);
      color: var(--text);
      line-height: 1.6;
    }
    
    header {
      position: sticky;
      top: 0;
      z-index: 100;
      background: var(--bg-secondary);
      border-bottom: 1px solid var(--border);
      padding: 16px 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    
    .header-left {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    
    .branch {
      font-family: var(--font-mono);
      font-size: 14px;
      color: var(--accent);
    }
    
    .commit {
      font-family: var(--font-mono);
      font-size: 12px;
      color: var(--text-muted);
    }
    
    .stats {
      display: flex;
      gap: 16px;
      font-size: 13px;
    }
    
    .stat-bug { color: var(--bug); }
    .stat-warning { color: var(--warning); }
    .stat-suggestion { color: var(--suggestion); }
    .stat-good { color: var(--good); }
    
    main {
      display: grid;
      grid-template-columns: 350px 1fr;
      min-height: calc(100vh - 60px);
    }
    
    #context {
      position: sticky;
      top: 60px;
      height: calc(100vh - 60px);
      overflow-y: auto;
      background: var(--bg-secondary);
      border-right: 1px solid var(--border);
      padding: 24px;
    }
    
    .context-section {
      opacity: 0.4;
      transition: opacity 0.2s;
      margin-bottom: 32px;
      padding-bottom: 24px;
      border-bottom: 1px solid var(--border);
    }
    
    .context-section.active {
      opacity: 1;
    }
    
    .context-section h3 {
      font-family: var(--font-mono);
      font-size: 13px;
      color: var(--accent);
      margin-bottom: 8px;
    }
    
    .context-section p {
      font-size: 14px;
      color: var(--text-secondary);
    }
    
    #diffs {
      padding: 24px;
    }
    
    .file-section {
      margin-bottom: 48px;
    }
    
    .file-header {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 16px;
      padding: 12px 16px;
      background: var(--bg-tertiary);
      border-radius: 8px;
    }
    
    .file-path {
      font-family: var(--font-mono);
      font-size: 14px;
      color: var(--text);
    }
    
    .file-stats {
      font-size: 12px;
      color: var(--text-muted);
    }
    
    .diff-container {
      border-radius: 8px;
      overflow: hidden;
      border: 1px solid var(--border);
    }
    
    .annotation {
      padding: 12px 16px;
      margin: 8px 0;
      border-radius: 6px;
      font-size: 13px;
    }
    
    .annotation-bug {
      background: rgba(214, 137, 128, 0.15);
      border-left: 3px solid var(--bug);
    }
    
    .annotation-warning {
      background: rgba(214, 163, 108, 0.15);
      border-left: 3px solid var(--warning);
    }
    
    .annotation-suggestion {
      background: rgba(108, 163, 214, 0.15);
      border-left: 3px solid var(--suggestion);
    }
    
    .annotation-good {
      background: rgba(143, 185, 150, 0.15);
      border-left: 3px solid var(--good);
    }
    
    .annotation-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 4px;
      font-weight: 600;
    }
    
    .annotation-text {
      color: var(--text-secondary);
    }
    
    .summary-box {
      background: var(--bg-tertiary);
      border-radius: 8px;
      padding: 20px;
      margin-bottom: 32px;
    }
    
    .summary-box h2 {
      font-size: 16px;
      margin-bottom: 12px;
    }
    
    .summary-box p {
      color: var(--text-secondary);
      font-size: 14px;
    }
  </style>
</head>
<body>
  <header>
    <div class="header-left">
      <span class="branch">{{BRANCH}}</span>
      <span class="commit">{{COMMIT}}</span>
    </div>
    <div class="stats">
      <span class="stat-bug">🔴 {{BUG_COUNT}} bugs</span>
      <span class="stat-warning">🟡 {{WARNING_COUNT}} warnings</span>
      <span class="stat-suggestion">💡 {{SUGGESTION_COUNT}} suggestions</span>
      <span class="stat-good">✅ {{GOOD_COUNT}} good</span>
    </div>
  </header>
  
  <main>
    <aside id="context">
      <div class="summary-box">
        <h2>Summary</h2>
        <p>{{SUMMARY}}</p>
      </div>
      <!-- Context sections populated by JS -->
    </aside>
    
    <section id="diffs">
      <!-- File sections populated by JS -->
    </section>
  </main>
  
  <script type="module">
    import { FileDiff, parsePatchFiles } from 'https://esm.sh/@pierre/diffs@1.0.1';
    
    const REVIEW_DATA_B64 = '{{REVIEW_DATA_B64}}';
    const decodeB64Utf8 = (b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      return new TextDecoder().decode(bytes);
    };
    const REVIEW_DATA = JSON.parse(decodeB64Utf8(REVIEW_DATA_B64));
    
    // Render file sections
    const diffsContainer = document.getElementById('diffs');
    const contextContainer = document.getElementById('context');

    const parsedPatches = parsePatchFiles(REVIEW_DATA.patch, 'review-export');
    const fileDiffs = parsedPatches.flatMap((p) => p.files);
    const fileDiffByPath = new Map(fileDiffs.map((d) => [d.name, d]));
    
    for (const file of REVIEW_DATA.files) {
      // Create context section
      const contextSection = document.createElement('div');
      contextSection.className = 'context-section';
      contextSection.dataset.file = file.path;
      contextSection.innerHTML = `
        <h3>${file.path}</h3>
        <p>${file.summary || ''}</p>
      `;
      contextContainer.appendChild(contextSection);
      
      // Create file section
      const fileSection = document.createElement('div');
      fileSection.className = 'file-section';
      fileSection.dataset.file = file.path;
      fileSection.innerHTML = `
        <div class="file-header">
          <span class="file-path">${file.path}</span>
          <span class="file-stats">+${file.additions || 0} -${file.deletions || 0}</span>
        </div>
        <div class="diff-container" id="diff-${CSS.escape(file.path)}"></div>
      `;
      diffsContainer.appendChild(fileSection);
      
      // Render diff
      const diffContainer = fileSection.querySelector('.diff-container');
      if (!diffContainer) continue;

      const fileDiff = fileDiffByPath.get(file.path);
      if (!fileDiff) continue;

      const annotations = (file.comments || []).map((c) => ({
        side: 'additions',
        lineNumber: c.startLine,
        metadata: c,
      }));

      const diffInstance = new FileDiff({
        theme: 'pierre-dark',
        diffStyle: 'unified',
        diffIndicators: 'bars',
        overflow: 'wrap',
        renderAnnotation: (ann) => {
          const c = ann.metadata;
          const typeClass = {
            bug: 'annotation-bug',
            warning: 'annotation-warning',
            suggestion: 'annotation-suggestion',
            good: 'annotation-good',
          }[c.type] || 'annotation-suggestion';

          const emoji = { bug: '🔴', warning: '🟡', suggestion: '💡', good: '✅' }[c.type] || '💡';

          const div = document.createElement('div');
          div.className = `annotation ${typeClass}`;
          div.innerHTML = `
            <div class="annotation-header">${emoji} ${c.type}</div>
            <div class="annotation-text">${c.text}</div>
          `;
          return div;
        },
      });

      diffInstance.render({
        fileDiff,
        fileContainer: diffContainer,
        lineAnnotations: annotations,
      });
    }
    
    // Scroll-sync via Intersection Observer
    const fileSections = document.querySelectorAll('.file-section');
    const contextSections = document.querySelectorAll('.context-section');
    
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const filePath = entry.target.dataset.file;
          contextSections.forEach(cs => {
            cs.classList.toggle('active', cs.dataset.file === filePath);
          });
        }
      });
    }, {
      rootMargin: '-100px 0px -60% 0px',
      threshold: 0
    });
    
    fileSections.forEach(section => observer.observe(section));
    
    // Activate first section
    if (contextSections.length > 0) {
      contextSections[0].classList.add('active');
    }
  </script>
</body>
</html>
```

#### 4. Add renderer script (deterministic substitution)
**File**: `~/.gitgud/skills/review-export/render.mjs`
**Lines**: new file

```js
import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";

function getArg(flag) {
  const idx = process.argv.indexOf(flag);
  return idx === -1 ? undefined : process.argv[idx + 1];
}

const templatePath = getArg("--template");
const dataPath = getArg("--data");
const outPath = getArg("--out");

if (!templatePath || !dataPath || !outPath) {
  console.error("Usage: node render.mjs --template template.html --data review.json --out review.html");
  process.exit(2);
}

const [template, jsonText] = await Promise.all([
  readFile(templatePath, "utf8"),
  readFile(dataPath, "utf8"),
]);

const reviewData = JSON.parse(jsonText);
const b64 = Buffer.from(JSON.stringify(reviewData), "utf8").toString("base64");

const counts = { bug: 0, warning: 0, suggestion: 0, good: 0 };
for (const f of reviewData.files ?? []) {
  for (const c of f.comments ?? []) {
    if (c.type in counts) counts[c.type]++;
  }
}

const html = template
  .replaceAll("{{BRANCH}}", reviewData.branch ?? "")
  .replaceAll("{{COMMIT}}", reviewData.commit ?? "")
  .replaceAll("{{SUMMARY}}", reviewData.summary ?? "")
  .replaceAll("{{BUG_COUNT}}", String(counts.bug))
  .replaceAll("{{WARNING_COUNT}}", String(counts.warning))
  .replaceAll("{{SUGGESTION_COUNT}}", String(counts.suggestion))
  .replaceAll("{{GOOD_COUNT}}", String(counts.good))
  .replaceAll("{{REVIEW_DATA_B64}}", b64);

await writeFile(outPath, html, "utf8");
console.log(outPath);
```

### Success Criteria

**Automated:**
```bash
gitgud show review-export | grep -q "review-export"  # Skill discoverable
test -f $(gitgud path review-export)/template.html   # Template exists
test -f $(gitgud path review-export)/render.mjs      # Renderer exists
```

**Manual:**
- [ ] Template renders when opened directly (with placeholder data)
- [ ] @pierre/diffs loads from CDN
- [ ] Scroll-sync works between panes

---

## Phase 3: Integration Test

### Overview
Test the complete flow: run `/review-export` on a real diff, verify HTML output.

### Prerequisites
- [ ] Phase 1 (command) complete
- [ ] Phase 2 (skill + template) complete
- [ ] A git repo with changes to review

### Test Steps

```bash
# In any git repo with recent changes
cd /Users/yesh/Documents/personal/marvin

# Run the command
/review-export HEAD~1

# Expected flow:
# 1. Gets diff via git diff --no-color HEAD~1
# 2. Chains subagents: review-explain → review-deep → review-verify
# 3. Parses XML outputs into /tmp/review.json
# 4. Reads template + render.mjs from skill
# 5. Renders /tmp/review-*.html
# 6. Opens in browser
```

### Success Criteria

**Automated:**
```bash
ls /tmp/review-*.html  # File was created
```

**Manual:**
- [ ] HTML file opens in browser
- [ ] Header shows branch + commit
- [ ] Left pane shows file summaries
- [ ] Right pane shows diffs with syntax highlighting
- [ ] Comments appear inline with correct badges (🔴🟡💡✅)
- [ ] Left pane updates as you scroll through diffs
- [ ] Stats in header match actual comment counts

---

## Data Structure

### REVIEW_DATA JSON Schema

```typescript
interface ReviewData {
  branch: string;
  commit: string;
  summary: string;
  patch: string;            // unified diff (multi-file, --no-color)
  files: Array<{
    path: string;
    summary: string;        // from review-explain
    additions: number;
    deletions: number;
    oldContents?: string;   // optional (if using parseDiffFromFile)
    newContents?: string;
    comments: Array<{
      startLine: number;
      endLine: number;
      type: 'bug' | 'warning' | 'suggestion' | 'good' | 'question';
      severity?: 'critical' | 'warning' | 'info';
      text: string;
      suggestedFix?: string;
    }>;
  }>;
  stats: {
    bugs: number;
    warnings: number;
    suggestions: number;
    good: number;
  };
}
```

---

## XML Parsing Notes

### review-explain output
```xml
<summary>Added authentication middleware</summary>
<fileOrder>
  <file>
    <filename>src/auth.ts</filename>
    <fileSummary>New JWT validation logic</fileSummary>
  </file>
</fileOrder>
```

### review-deep output
```xml
<detailedReview>
## src/auth.ts

### Line 42-45: 🔴 Bug
Missing token expiry check
</detailedReview>
```

Parse with regex or simple XML extraction:
```javascript
// Extract tag content
const extractTag = (xml, tag) => {
  const match = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return match ? match[1].trim() : null;
};

const extractAllTags = (xml, tag) => {
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "g");
  return Array.from(xml.matchAll(re)).map((m) => m[1].trim());
};

// review-explain: fileOrder parsing
const parseFileOrder = (xml) => {
  const fileOrderXml = extractTag(xml, "fileOrder") ?? "";
  return extractAllTags(fileOrderXml, "file").map((fileXml) => ({
    filename: extractTag(fileXml, "filename") ?? "",
    fileSummary: extractTag(fileXml, "fileSummary") ?? "",
  })).filter((f) => f.filename);
};

// review-deep: parse markdown headings into structured comments
// Assumes per-file sections start with "## path" and comments start with "### Line X-Y: 🔴 Bug" etc.
const parseDeepReviewMarkdown = (xml) => {
  const md = extractTag(xml, "detailedReview") ?? "";
  const results = [];
  let currentFile = null;

  for (const line of md.split("\n")) {
    const fileMatch = line.match(/^##\s+(.+?)\s*$/);
    if (fileMatch) {
      currentFile = fileMatch[1];
      continue;
    }

    const commentMatch = line.match(/^###\s+Line\s+(\d+)(?:-(\d+))?:\s*(🔴\s*Bug|🟡\s*Warning|💡\s*Suggestion|✅\s*Good|❓\s*Question)\s*$/);
    if (commentMatch && currentFile) {
      const startLine = Number(commentMatch[1]);
      const endLine = Number(commentMatch[2] ?? commentMatch[1]);
      const label = commentMatch[3];
      const type = label.includes("Bug")
        ? "bug"
        : label.includes("Warning")
          ? "warning"
          : label.includes("Good")
            ? "good"
            : label.includes("Question")
              ? "question"
              : "suggestion";

      results.push({ file: currentFile, startLine, endLine, type, text: "" });
      continue;
    }

    // Accumulate text into last comment until next heading
    const last = results.at(-1);
    if (last && currentFile === last.file) {
      last.text += (last.text ? "\n" : "") + line;
    }
  }

  // Cleanup
  for (const c of results) c.text = c.text.trim();
  return results.filter((c) => c.text);
};
```

### review-verify output
```xml
<verification>
  <verified>
    <comment>
      <file>src/auth.ts</file>
      <startLine>42</startLine>
      <type>bug</type>
      <text>Confirmed: token expiry not checked</text>
    </comment>
  </verified>
</verification>
```

---

## Anti-Patterns to Avoid

1. **Don't hardcode file paths** - Use `/tmp/` for output
2. **Don't require build step** - CDN for @pierre/diffs
3. **Don't block on network** - Fail gracefully if CDN unavailable
4. **Don't over-engineer parsing** - Simple regex for XML, don't need full parser

## Open Questions

- [x] CDN for @pierre/diffs? → Yes, esm.sh
- [x] Dark mode only or toggle? → Dark mode only (matches cerebro)
- [x] Where to save HTML? → `/tmp/review-{timestamp}.html`
- [x] Command vs skill? → Both: command orchestrates, skill holds template

## Files to Create

| File | Purpose |
|------|---------|
| `~/.config/marvin/commands/review-export.md` | Slash command orchestration |
| `~/.gitgud/skills/review-export/SKILL.md` | Skill metadata + docs |
| `~/.gitgud/skills/review-export/template.html` | HTML template |
| `~/.gitgud/skills/review-export/render.mjs` | Template renderer script |

## References

- Command pattern: `~/.config/marvin/commands/review.md`
- Skill pattern: `~/.gitgud/skills/dev-browser/SKILL.md`
- diffs docs: https://diffs.com/docs
- Cerebro source: `/Users/yesh/Documents/personal/reference/guck/`
- Review agents: `~/.config/marvin/agents/review-*.md`
