---
name: ui-ux-pro-max
description: Ultra-premium UI/UX design system specializing in high-density enterprise log analytics, multi-theme palette architecture, GPU-accelerated glassmorphism, and accessible micro-interactions.
license: MIT
metadata:
  author: Antigravity Deepmind UI/UX Lab
---

# UI/UX Pro Max: Enterprise Analytics & Multi-Theme Design System

This skill provides the comprehensive architectural rules, component modularity standards, typography pairings, color theory matrices, and micro-interaction specifications for building world-class telemetry dashboards and log analytics user interfaces.

---

## 🎨 Multi-Theme Color Matrices

Enterprise log analytics applications require theme diversity to accommodate various lighting environments, monitor setups, and NOC/SOC user workflows.

### 1. Obsidian Sage (`[data-theme="dark"]` - Default)
* **Environment**: Dim environments, standard monitoring NOCs/SOCs.
* **Base Viewport**: `#111413` (Deep Obsidian)
* **Surface Glass**: `#181D1A` (Charcoal Slate Glass)
* **Surface Elevated**: `#232A26`
* **Primary Text**: `#EDEFEA` (Soft luminescence)
* **Secondary Text**: `#A4AD8C` (Muted Sage)
* **Accent Action**: `#5C8750` / `#6F7B60` (Vibrant Moss Sage)
* **Border**: `rgba(146, 222, 139, 0.2)`

### 2. Milk White Glass (`[data-theme="light"]`)
* **Environment**: Daytime, high-glare and well-lit office environments.
* **Base Viewport**: `#FAF7F0` (Frosted Ivory Milk)
* **Surface Glass**: `#FEFCFF` (Alabaster Glass)
* **Surface Elevated**: `#F0EAE1`
* **Primary Text**: `#2C332E` (Deep Charcoal Green)
* **Secondary Text**: `#5C6656` (Olive Smoke)
* **Accent Action**: `#6F7B60` (Earthy Sage)
* **Border**: `rgba(111, 123, 96, 0.22)`

### 3. Midnight Azure (`[data-theme="midnight"]`)
* **Environment**: Azure telemetry & cloud infrastructure operations.
* **Base Viewport**: `#0B0F19` (Deep Space Navy)
* **Surface Glass**: `#111827` (Navy Slate Glass)
* **Surface Elevated**: `#1E293B`
* **Primary Text**: `#F1F5F9` (Ice White)
* **Secondary Text**: `#94A3B8` (Cool Slate)
* **Accent Action**: `#0078D4` / `#38BDF8` (Azure Cyan Blue)
* **Border**: `rgba(56, 189, 248, 0.2)`

### 4. Royal Amethyst (`[data-theme="amethyst"]`)
* **Environment**: Luxury telemetry, high-contrast dark room analysis.
* **Base Viewport**: `#120D1D` (Deep Velvet Night)
* **Surface Glass**: `#1A132B` (Purple Velvet Glass)
* **Surface Elevated**: `#281E40`
* **Primary Text**: `#F5F3FF` (Luminous Violet White)
* **Secondary Text**: `#C084FC` (Lavender Mist)
* **Accent Action**: `#A855F7` (Neon Purple)
* **Border**: `rgba(168, 85, 247, 0.22)`

### 5. Sunset Amber (`[data-theme="amber"]`)
* **Environment**: Warm night mode, reduced blue-light eye strain.
* **Base Viewport**: `#181310` (Espresso Night)
* **Surface Glass**: `#231B17` (Warm Bronze Glass)
* **Surface Elevated**: `#332720`
* **Primary Text**: `#FEF3C7` (Warm Cream)
* **Secondary Text**: `#D97706` (Amber Bronze)
* **Accent Action**: `#F59E0B` (Golden Amber)
* **Border**: `rgba(245, 158, 11, 0.22)`

### 6. Arctic Glacier (`[data-theme="nordic"]`)
* **Environment**: High-precision Nordic engineering dashboards.
* **Base Viewport**: `#0A1618` (Deep Arctic Fjord)
* **Surface Glass**: `#102226` (Frosted Ice Glass)
* **Surface Elevated**: `#173136`
* **Primary Text**: `#E6FFFA` (Polar Mist)
* **Secondary Text**: `#5EEAD4` (Glacier Teal)
* **Accent Action**: `#14B8A6` (Mint Emerald)
* **Border**: `rgba(20, 184, 166, 0.22)`

---

## 📐 Token Hierarchy & CSS Variable Architecture

Every UI component must reference centralized CSS custom properties declared on `:root` and `[data-theme]`:

| Token | Semantic Purpose |
|---|---|
| `--color-bg-base` | Page viewport foundation background. |
| `--color-surface` | Primary glass container surfaces (tables, panels). |
| `--color-surface-elevated` | Floating controls, popovers, dropdown items. |
| `--color-text-primary` | High-contrast data strings, query text, active tab headers. |
| `--color-text-secondary` | Column types, telemetry percentages, metadata. |
| `--color-text-muted` | Line numbers, unselected chips, empty state hints. |
| `--color-accent-action` | Primary interactive buttons, checkboxes, selected states. |
| `--glass-border` | Subtle translucent outlines with high border readability. |
| `--glass-popover-bg` | High-opacity popover glass preventing content bleed-through. |
| `--glass-popover-blur` | GPU-accelerated backdrop blur for modals and floating flyouts. |

---

## 🧩 Modular Component Architecture Guidelines

Modern enterprise interfaces must be strictly modularized into focused, single-responsibility components:

1. **Selectors (`src/components/selectors/`)**:
   - `GraphicalSubscriptionSelect`: Filter workspaces by Azure subscription with live badge counters.
   - `GraphicalWorkspaceSelect`: Searchable dropdown with inline GUID preview and manual GUID fallback.
   - `GraphicalPresetSelect`: Categorized log preset picker with distinctive preset color dots.
   - `GraphicalThemeSelect`: Visual theme switcher with color swatch preview dots.

2. **Editor (`src/components/editor/`)**:
   - `KqlCodeEditor`: High-density KQL editor with auto-complete suggestions, draggable suggestion box, live syntax diagnostics, minimize/expanded heights, and immediate run triggers.

3. **Controls (`src/components/controls/`)**:
   - `FilterConditionsDropdown`: Multi-select predicate conditions with operator selectors (`==`, `!=`, `contains`, `between`, `in`, `has`) and direct value inputs.
   - `ProjectColumnsDropdown`: Multi-select projection columns with select-all/clear-all actions.
   - `DynamicFiltersBar`: Context-aware dynamic filters with distinct value search and active filter tag chips.

4. **Table & Telemetry (`src/components/table/`)**:
   - `ResultTable`: PrimaryResult data grid with drag-and-drop column reordering, double-click text wrapping, column resizing, timezone toggling (UTC/Local), cascading value filter flyouts, and secondary **Summarized Column Telemetry** table supporting multi-column tuple grouping and pagination.

5. **Common Utilities (`src/components/common/`)**:
   - `SegmentedControl`: Rapid timespan switching pills.
   - `GlassDateTimePicker`: Multi-month glass calendar popover with hour/minute precision and "Now" preset.
   - `QueryWarningAlert`: Collapsible partial error & query truncation alert.

---

## ⚡ GPU Performance & Rendering Rules

1. **Selective Backdrop Blur**: Never apply `backdrop-filter: blur(...)` to table data cells (`<td>`) or rows (`<tr>`). Apply blur only to top-level panel surfaces, floating headers, and popover overlays.
2. **Scroll Synchronization**: Sync table body, header, and top scrollbars using `requestAnimationFrame` to eliminate layout thrashing and jitter.
3. **Hardware Acceleration**: Use CSS `transform: translate3d(...)` for draggable floating popovers rather than mutating `top`/`left` offsets on every mousemove.
4. **Theme Transitions**: Apply transitions exclusively to color properties (`color`, `background-color`, `border-color`) with durations between `0.12s` and `0.2s` for a crisp, responsive feel.
5. **No Layout Shift**: Maintain strict fixed or min/max column width models (`width: ${width}px; minWidth: ${width}px; maxWidth: ${width}px;`) to prevent jumping during cell wrapping or sorting.
