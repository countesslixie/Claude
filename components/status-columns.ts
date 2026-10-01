/**
 * D116 — the filing page's two fixed right-hand columns: the status pill
 * (left-aligned in its column) and Expand/Collapse (right-aligned in its
 * column). Every group header and the tax payable line share these exact
 * widths, so the pills and the links line up down the page. A header with no
 * pill or no link still keeps its empty cell.
 */
export const STATUS_GRID = "grid grid-cols-[minmax(0,1fr)_7.5rem_4.5rem] items-center gap-x-3";

/**
 * The tax payable line sits outside the Steps card, so its right padding makes
 * up the difference to a group header's right edge: Card border 1px + card
 * body 1.25rem + group border 1px + group padding 0.75rem, less the line's own
 * 1px border.
 */
export const STATUS_STRIP_PADDING = "pl-3 pr-[2.0625rem]";
