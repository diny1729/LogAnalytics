---
name: glassmorphism
description: Milk White Glass and Dark Obsidian Glass UI design system for log checking with high-contrast text, earthy sage borders, muted olive accents, and GPU-optimized rendering.
license: MIT
metadata:
  author: typeui.sh
---

<!-- TYPEUI_SH_MANAGED_START -->
# Web Design Specification: Milk White Glass & Dark Obsidian Glass UI for Log Checking

This document details the typography, design layout system, CSS glassmorphism implementation, and dual Light/Dark theme specifications for the **Log Checking Platform**.

---

## 🎨 Dual Theme Color Palette & Mapping

High visibility of text is balanced against prolonged monitoring eye strain using a muted, high-contrast scheme in both Light and Dark themes.

### Light Theme (Milk White Glass)
| Role | Color Name | Hex Code | Interface Assignment |
| :--- | :--- | :--- | :--- |
| **Background / Base** | Milk Glass | `#FAF7F0` | Main application grid backdrop. |
| **Surface / Cards** | Pure Soft White | `#FEFCFF` | Frosted log containers, data tables, filter bars. |
| **Primary Text** | Deep Charcoal-Green | `#2C332E` | Log output strings, terminal text, main headers. |
| **Secondary / Muted** | Earthy Sage | `#A4AD8C` | Timestamps, metadata, panel borders, line numbers. |
| **Accent / Action** | Muted Olive | `#6F7B60` | Search buttons, action states, dynamic filtering tags. |

### Dark Theme (Dark Obsidian Glass `[data-theme="dark"]`)
| Role | Color Name | Hex Code | Interface Assignment |
| :--- | :--- | :--- | :--- |
| **Background / Base** | Deep Obsidian | `#111413` | Dark application backdrop. |
| **Surface / Cards** | Charcoal Slate | `#181D1A` | Frosted dark glass containers, data tables, filter bars. |
| **Primary Text** | Soft Milk Luminescence | `#EDEFEA` | Log strings, terminal text, main headers. |
| **Secondary / Muted** | Sage Muted | `#83917E` | Timestamps, metadata, panel borders, line numbers. |
| **Accent / Action** | Deep Obsidian Sage | `#3D6036` | Buttons, active tabs, filter tags, focus rings. |

---

## 🔤 Typography Pairings

* **UI & Hierarchy (Headers & Controls)**: `Inter`, `system-ui`, `-apple-system`, sans-serif (`600 Semi-Bold`, `500 Medium`).
* **Log Stream Data (The Console Grid)**: `JetBrains Mono`, `Fira Code`, `SF Mono`, monospace (`400 Regular`, `500 Medium`).

---

## 🎨 Theme Switching Implementation

The application toggles `data-theme="light"` and `data-theme="dark"` on `document.documentElement` and persists the selection in `localStorage` under `kql_app_theme`.

---

## ⚡ Performance Optimization Rules
- **GPU Fillrate Optimization**: Limit `backdrop-filter: blur()` to top-level cards, topbar, and modals. Never apply `backdrop-filter` to individual table cells or repeated rows.
- **CSS Layout Containment**: Use `contain: content;` on scrollable data tables and log viewer panels.
- **Hardware Acceleration**: Transitions strictly on `transform`, `opacity`, and `background-color` with `will-change: transform`.
<!-- TYPEUI_SH_MANAGED_END -->
