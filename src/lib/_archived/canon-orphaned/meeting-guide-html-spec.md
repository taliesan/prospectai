# Meeting Guide — HTML Implementation Spec

This document tells you how to render a Meeting Guide as an HTML file. The input is a Meeting Guide in markdown (the output of Stage 9). The output is a single self-contained HTML file with inline CSS.

## Fonts

Load from Google Fonts:
```
https://fonts.googleapis.com/css2?family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,600;0,8..60,700;1,8..60,400&family=Instrument+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap
```

Usage:
- **Source Serif 4** — header donor name, beat numbers, beat titles, One Line text
- **Instrument Sans** — all body text, setup bullets, phase content
- **IBM Plex Mono** — section labels (SETUP, THE ARC, TRIPWIRES, ONE LINE), phase labels (START, STAY, CONTINUE), tripwire tags (TELL, RECOVERY)

## Color System

```css
:root {
  --ink: #1c1917;
  --ink-secondary: #78716c;
  --ink-tertiary: #a8a29e;
  --paper: #fafaf9;
  --surface: #ffffff;
  --rule: #e7e5e4;
  --rule-strong: #d6d3d1;
  --accent: #b45309;
  --accent-light: #fef3c7;
  --beat-bg: #f5f5f4;
  --start-color: #0f766e;
  --start-bg: #f0fdfa;
  --start-border: #99f6e4;
  --stay-color: #1e40af;
  --stay-bg: #eff6ff;
  --stay-border: #bfdbfe;
  --continue-color: #7e22ce;
  --continue-bg: #faf5ff;
  --continue-border: #d8b4fe;
  --trip-color: #991b1b;
  --trip-bg: #fef2f2;
  --trip-border: #fecaca;
}
```

Three distinct hues for the three phases: teal (START), blue (STAY), purple (CONTINUE). Tripwires are red. One Line is white-on-dark.

## Page Layout

```
.page: max-width 820px, centered, padding 48px 40px 80px
body: Instrument Sans, 14px, var(--paper) background
```

## Section-by-Section Mapping

### Header

The donor's name from the guide's `## MEETING GUIDE — [NAME]` line.

```html
<div class="header">
  <div class="header-label">Meeting Guide</div>  <!-- IBM Plex Mono, 11px, uppercase -->
  <h1>Craig Newmark</h1>                          <!-- Source Serif 4, 32px, bold -->
</div>
<!-- header has ::after pseudo-element: 2px solid var(--ink) rule -->
```

### Setup

Four subsections from the guide's `### SETUP`: Who They Are, How to Engage, Where to Focus, Logistics.

```html
<div class="setup">
  <div class="section-label">Setup</div>  <!-- IBM Plex Mono, 11px, uppercase, bottom border -->

  <div class="setup-group">
    <div class="setup-heading">Who They Are</div>  <!-- 13px, bold, uppercase -->
    <ul class="setup-bullets">
      <li>[bullet text]</li>  <!-- 13.5px, em dash before via ::before pseudo-element -->
      <li>[bullet text]</li>
      <li>[bullet text]</li>
    </ul>
  </div>

  <!-- Repeat for How to Engage (3 bullets), Where to Focus (5 bullets), Logistics (3 bullets) -->
</div>
```

Logistics bullets contain `<strong>` tags for the label (Venue:, Duration:, Who to bring:).

Where to Focus bullets may contain `<strong>` tags for strategic component names (Organize, Fight, Innovate, etc.).

### The Arc

Five beats from the guide's `### THE ARC`. Each beat has: title, goal, START, STAY, CONTINUE.

```html
<div class="arc">
  <div class="section-label">The Arc</div>

  <div class="beat">
    <div class="beat-header">
      <div class="beat-number">1</div>           <!-- 48px circle, dark bg, Source Serif 4, 22px -->
      <div class="beat-title-block">
        <div class="beat-title">Get Them Talking</div>  <!-- Source Serif 4, 18px, semibold -->
        <div class="beat-goal">[italic goal text]</div>  <!-- 13px, italic, secondary color -->
      </div>
    </div>

    <div class="beat-body">                        <!-- margin-left: 64px (indented from number) -->

      <div class="phase start">
        <div class="phase-label">Start</div>       <!-- teal bg, white text, rounded top -->
        <div class="phase-content">                 <!-- teal-tinted bg, teal border -->
          [START text from guide]
        </div>
      </div>

      <div class="phase stay">
        <div class="phase-label">Stay</div>         <!-- blue bg, white text -->
        <div class="phase-content">                  <!-- blue-tinted bg, blue border -->
          <p>[STAY prose paragraphs]</p>

          <!-- If STAY has bulleted scenarios: -->
          <ul class="stay-scenarios">
            <li><strong>[scenario label]</strong> — [scenario text]</li>
            <li><strong>[scenario label]</strong> — [scenario text]</li>
            <li><strong>[scenario label]</strong> — [scenario text]</li>
          </ul>

          <!-- Stalling indicator (always present, at bottom of STAY): -->
          <div class="stalling">
            <span class="stalling-label">Stalling:</span> [stalling text and recovery]
          </div>
        </div>
      </div>

      <div class="phase continue">
        <div class="phase-label">Continue</div>     <!-- purple bg, white text -->
        <div class="phase-content">                  <!-- purple-tinted bg, purple border -->
          [CONTINUE text from guide]
        </div>
      </div>

    </div>
  </div>

  <div class="beat-connector"></div>  <!-- 2px vertical line, 20px tall, margin-left 23px -->

  <!-- Repeat for beats 2-5 -->
</div>
```

**Beat titles and goals are fixed across all guides:**
1. Get Them Talking / *Get them present as a person, not a title...*
2. Let Them Name the Stakes / *Get them to say, in their own words...*
3. Combine Your Worlds / *Connect their language to the work...*
4. Press Play / *Start the work before the meeting ends...*
5. Unlock the Network / *Find out who else should be in this conversation...*

**STAY formatting varies by beat.** Some beats use prose only. Some use prose + bulleted scenarios. The guide's markdown determines which. When the guide has bulleted items inside STAY with bold labels, render them as `<ul class="stay-scenarios">` with `<strong>` labels. When STAY is prose only, render as `<p>` tags.

**Stalling indicator:** Every STAY section contains a stalling indicator. In the markdown guide, this appears after the main STAY content — often as the last paragraph starting with "When it's stalling:" or "If he..." describing a failure state. Render it inside a `<div class="stalling">` with the amber `<span class="stalling-label">Stalling:</span>` prefix. The stalling div has a dashed top border to visually separate it from the main STAY content.

**Connectors:** Place a `<div class="beat-connector"></div>` between each beat (not after the last one).

### Tripwires

Three items from the guide's `### TRIPWIRES`.

```html
<div class="tripwires">
  <div class="section-label">Tripwires</div>
  <div class="tripwire-list">

    <div class="tripwire">  <!-- red left border, red-tinted bg -->
      <div class="tripwire-name">[Label].</div>                          <!-- 14px, bold, red -->
      <div class="tripwire-row">
        <span class="tripwire-tag">Tell:</span>                         <!-- IBM Plex Mono, red -->
        <em>[tell text in italic]</em>
      </div>
      <div class="tripwire-row">
        <span class="tripwire-tag">Recovery:</span>                     <!-- IBM Plex Mono, red -->
        [recovery text, not italic]
      </div>
    </div>

    <!-- Repeat for 3 total -->
  </div>
</div>
```

### One Line

Single sentence from the guide's `### ONE LINE`.

```html
<div class="one-line">
  <div class="section-label">One Line</div>
  <div class="one-line-box">  <!-- dark bg, white text, 8px border-radius, centered -->
    <p>[one line text]</p>    <!-- Source Serif 4, 18px, semibold, italic -->
  </div>
</div>
```

## Parsing the Markdown Guide

The guide markdown has a consistent structure. Parse it as follows:

1. **Header:** `## MEETING GUIDE — [NAME]` → extract name
2. **Setup subsections:** Look for `**Who They Are.**`, `**How to Engage.**`, `**Where to Focus.**`, `**Logistics.**` — each followed by `- ` bullets
3. **Beats:** Look for `**Beat N: [Title]**` followed by italic goal, then `**START.**`, `**STAY.**`, `**CONTINUE.**`
4. **Within STAY:** Paragraphs are `<p>` tags. Lines starting with `- **` are scenario bullets. The stalling indicator is the last content block — look for patterns like "When it's stalling:", "If he's...", or content describing failure states after the main STAY instruction
5. **Tripwires:** Look for `**[Label].**` followed by `*Tell:*` and `*Recovery:*`
6. **One Line:** The final line of content after `### ONE LINE`

## Reference Implementation

The file `meeting-guide-newmark.html` in outputs is the canonical reference. All generated HTML guides should match its structure, class names, and CSS exactly. The CSS goes in a `<style>` tag in `<head>` — no external stylesheets except the Google Fonts link.

## Print Styles

Include these for fundraisers who print:

```css
@media print {
  body { background: white; font-size: 12px; }
  .page { padding: 24px; max-width: none; }
  .beat-number { width: 40px; height: 40px; font-size: 18px; }
  .phase { break-inside: avoid; }
  .tripwire { break-inside: avoid; }
  .one-line-box {
    background: var(--ink) !important;
    color: white !important;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
}
```
