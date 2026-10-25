---
name: RouteLab Model Review Dossier
description: An evidence-first interface for task-specific model allocation.
colors:
  archival-paper: "#f3efe4"
  paper-deep: "#e9e1d2"
  decision-sheet: "#fbf8f0"
  audit-ink: "#111b33"
  structural-blue: "#214d86"
  decision-vermilion: "#d14c31"
  passing-green: "#62d975"
  quiet-ink: "#667080"
typography:
  display:
    fontFamily: "Newsreader Variable, Newsreader, Georgia, serif"
    fontSize: "clamp(58px, 6.4vw, 92px)"
    fontWeight: 600
    lineHeight: 0.9
    letterSpacing: "-0.035em"
  headline:
    fontFamily: "Newsreader Variable, Newsreader, Georgia, serif"
    fontSize: "46px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "-0.025em"
  body:
    fontFamily: "Inter Variable, Inter, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.65
  label:
    fontFamily: "DM Mono, monospace"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1.45
    letterSpacing: "0.05em"
rounded:
  document: "2px"
  status: "1px"
spacing:
  xs: "8px"
  sm: "12px"
  md: "18px"
  lg: "28px"
  section: "88px"
components:
  button-primary:
    backgroundColor: "{colors.passing-green}"
    textColor: "#0b2915"
    rounded: "{rounded.document}"
    padding: "0 18px"
  panel:
    backgroundColor: "{colors.decision-sheet}"
    textColor: "{colors.audit-ink}"
    rounded: "{rounded.document}"
    padding: "20px"
---

# Design System: RouteLab Model Review Dossier

## Overview

**Creative North Star: "The Model Review Dossier"**

RouteLab presents model allocation as a reviewable engineering decision, not a mysterious automated recommendation. The visual system borrows from approval packets, change-control records, and editorial technical briefs: information is arranged in ruled ledgers, evidence panels, status marks, and versioned records.

The public page uses the full editorial voice. The authenticated app becomes a denser operate mode, keeping the same paper, navy ink, blue rules, and constrained decision colors. The product should feel inspectable before it feels futuristic.

**Key Characteristics:**
- Editorial judgment paired with operational density
- Flat paper surfaces organized by rules, not floating cards
- Vermilion for consequential review marks; green only for passing/current states
- Strong differentiation between prose, interface language, and measurements

## Colors

Warm paper creates the working surface; navy carries nearly all reading; blue builds structure; vermilion and green are scarce decision signals.

### Primary
- **Structural Blue** (`#214d86`): section rules, table structure, and selected document controls.
- **Audit Ink** (`#111b33`): primary text, the authenticated sidebar, and high-authority surfaces.

### Secondary
- **Decision Vermilion** (`#d14c31`): review stamps, caution borders, and consequential annotations.
- **Passing Green** (`#62d975`): primary actions and confirmed/passing states only.

### Neutral
- **Archival Paper** (`#f3efe4`): the page ground.
- **Decision Sheet** (`#fbf8f0`): panels, fields, and records.
- **Quiet Ink** (`#667080`): explanatory and secondary text.

**The Scarce Signal Rule.** Vermilion and green identify decisions; neither becomes decorative atmosphere.

## Typography

**Display Font:** Newsreader Variable, with Georgia fallback  
**Body Font:** Inter Variable, with system UI fallback  
**Label/Mono Font:** DM Mono

Newsreader turns product conclusions into editorial judgments. Inter keeps controls and explanations direct. DM Mono is reserved for versions, identifiers, measurements, and compact document metadata.

### Hierarchy
- **Display** (600, `clamp(58px, 6.4vw, 92px)`, `0.9`): public promise only.
- **Headline** (600, `46px`, `1`): major landing sections; authenticated page titles use `34px`.
- **Title** (600, `22–30px`): panel and evidence headings.
- **Body** (400, `14–18px`, `1.55–1.65`): descriptions and explanatory content.
- **Label** (600, `12px`, `0.05em`, uppercase): document metadata, table headers, states, and measurements.

**The Three Voices Rule.** Use serif for judgment, sans for operation, and mono only for evidence metadata.

## Layout

The landing page uses a maximum `1320px` reading field with a wide editorial promise, a compact decision docket, and a full-width routing ledger in the first viewport. Sections are separated by structural blue rules and use an `88px` desktop rhythm. Product proof pairs explanatory copy with current screenshots instead of decorative art.

The authenticated app uses a fixed `252px` navy sidebar and a horizontally scrollable content area. Dense tables and minimum-width operational views retain horizontal scrolling on smaller screens. At `1050px`, the landing docket stacks below the promise; at `760px`, ledgers become single-column records and the app uses its existing mobile navigation.

## Elevation & Depth

The system is flat by default. Depth comes from a small hard registration offset on consequential documents and panels (`4–8px` in low-opacity blue or vermilion), evoking stacked paper rather than floating glass. There are no glows or ambient glass shadows.

**The Registered Paper Rule.** Offset shadows indicate a physical decision artifact; ordinary data rows remain flat.

## Shapes

Corners are square or nearly square (`1–2px`). Borders and rules carry hierarchy. Circular geometry is limited to the review stamp and status dots; it is not the default container language.

## Components

### Buttons
- **Shape:** document corner (`2px`) with a compact rectangular silhouette.
- **Primary:** passing green, dark text, thin green border, and a small dark registration offset.
- **Secondary:** transparent with a blue underline or ruled border.
- **Focus:** a visible vermilion outline with `3px` offset.

### Cards / Containers
- **Corner Style:** `1–2px`.
- **Background:** translucent decision-sheet over archival paper.
- **Border:** structural blue at low opacity; vermilion only for consequential notices.
- **Internal Padding:** generally `18–28px`.

### Inputs / Fields
- **Style:** decision-sheet fill, blue rule, square corners.
- **Focus:** preserve the global vermilion focus ring.
- **Disabled:** retain readable quiet ink; never fade below useful contrast.

### Navigation
- The public masthead is a single ruled row with document metadata between brand and navigation.
- The application sidebar uses audit ink, white labels, green active status, and square icon boxes.

### Decision Docket
The docket is the signature component: a vermilion ruled review record with criterion rows, preparation metadata, and a single circular STANDARD mark. It communicates the standard without fabricating a customer outcome.

## Do's and Don'ts

### Do:
- **Do** expose the evidence dimension, decision state, and runtime behavior together.
- **Do** use current product screenshots as factual proof.
- **Do** keep dense operational tables horizontally scrollable when needed.
- **Do** reserve mono for IDs, versions, numbers, and document metadata.

### Don't:
- **Don't** use glows, glassmorphism, gradient text, or generic neon AI imagery.
- **Don't** turn every group of content into a rounded floating card.
- **Don't** use green as general decoration or vermilion as ambient color.
- **Don't** fabricate approval, savings, or performance outcomes to fill a visual.
