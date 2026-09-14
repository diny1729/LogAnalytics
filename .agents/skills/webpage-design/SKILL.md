---
name: webpage-design
description: >-
  Guidelines, design patterns, and procedures for crafting sleek, modern, and compact web application layouts.
  Use when designing or refining UI layouts, eliminating excessive vertical gaps or card padding, and implementing
  compact cascading multi-level dropdown selectors and glassmorphic telemetry controls.
---

# Webpage Design & Compact Layout Skill

This skill guides the design of modern, compact, and highly aesthetic telemetry dashboards, eliminating unwanted vertical whitespace and implementing cascading two-level popover selectors.

## Core Design Principles

### 1. Zero Wasted Vertical Space
- Avoid giant placeholder containers or flexible cards that vertically stretch unnecessarily.
- Use `display: inline-flex` or tight `flex` rows for toolbar controls rather than multi-row stacked boxes with large margins.
- Ensure controls have explicit, balanced heights (e.g. `34px` - `38px`) with balanced padding (`6px 12px`).

### 2. Cascading Menu Selector Pattern (Filter Values Style)
When selecting items with hierarchical relationships (such as **Subscriptions -> Workspaces** or **Columns -> Distinct Values**), avoid separate stacked dropdowns. Instead, implement a unified **Cascading Two-Level Popover**:
- **Trigger Button**: A single, clean button showing active selection badges, icons, and a chevron (`>`).
  - Example: `[ 🏢 Azure Workspaces (Production / Prod-EastUS) > ]`
- **Level 1 (Left Pane)**:
  - Scrollable list of parent categories (e.g., Azure Subscriptions or "All Subscriptions").
  - Hover or click activates the right pane.
  - Displays parent name, item count badge, and a right arrow `ChevronRight`.
- **Level 2 (Right Pane)**:
  - Header with parent category title, search filter input, and count.
  - Scrollable list of child items (e.g., Log Analytics Workspaces) with formatted GUIDs, badges, and selection indicators (`✓ Selected`).
  - Optional action buttons (e.g. `✏️ Manual GUID input`).

### 3. Visual Styling Tokens (Cyber Dark Glassmorphic)
- **Backgrounds**: `rgba(6, 28, 38, 0.96)` with `backdrop-filter: blur(16px)`
- **Borders**: Subtly glowing teal/emerald `rgba(16, 185, 129, 0.4)` or cyan `rgba(56, 189, 248, 0.35)`
- **Shadows**: `0 16px 48px rgba(0, 0, 0, 0.8), 0 0 20px rgba(16, 185, 129, 0.2)`
- **Accents**: Cyan `#38bdf8` for subscriptions, Emerald `#34d399` for workspaces and active states.
