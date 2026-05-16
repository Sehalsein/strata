import type { ReactElement } from "react";

export const I: Record<string, ReactElement> = {
  search: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <circle cx="7" cy="7" r="5" />
      <path d="M10.5 10.5L14 14" />
    </svg>
  ),
  play: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
      <polygon points="3,2 12,7 3,12" />
    </svg>
  ),
  plus: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <path d="M7 2v10M2 7h10" />
    </svg>
  ),
  download: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 1v9M3 7l4 4 4-4M2 13h10" />
    </svg>
  ),
  more: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
      <circle cx="3" cy="7" r="1.4" />
      <circle cx="7" cy="7" r="1.4" />
      <circle cx="11" cy="7" r="1.4" />
    </svg>
  ),
  cast: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <path d="M1 11.5a3 3 0 0 1 1.5 1.5M1 9a5.5 5.5 0 0 1 4 4M1 6.5a8 8 0 0 1 6.5 6.5" />
      <path d="M1 4V2.5A1 1 0 0 1 2 1.5h10A1 1 0 0 1 13 2.5v9a1 1 0 0 1-1 1H8" />
    </svg>
  ),
  home: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
      <path d="M2 7l6-5 6 5v7H2z" />
    </svg>
  ),
  film: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="2" y="2" width="12" height="12" rx="1" />
      <path d="M5 2v12M11 2v12M2 5h3M11 5h3M2 11h3M11 11h3" />
    </svg>
  ),
  tv: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
      <rect x="1.5" y="3" width="13" height="9" rx="1" />
      <path d="M5 14h6" />
    </svg>
  ),
  list: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M2 4h12M2 8h12M2 12h12" />
    </svg>
  ),
  folder: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
      <path d="M1.5 3.5h4l1.5 1.5h7.5v8.5h-13z" />
    </svg>
  ),
  settings: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="8" cy="8" r="2" />
      <path d="M8 1v2M8 13v2M3.5 3.5l1.4 1.4M11.1 11.1l1.4 1.4M1 8h2M13 8h2M3.5 12.5l1.4-1.4M11.1 4.9l1.4-1.4" />
    </svg>
  ),
  users: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="6" cy="5" r="2.5" />
      <circle cx="11" cy="6" r="2" />
      <path d="M1.5 13.5c.5-2.5 2.5-4 4.5-4s3.5 1 4 3M9 12c.5-1.5 2-2.5 3.5-2.5s2.5.5 2.5 2" />
    </svg>
  ),
  bookmark: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
      <path d="M3 2h8v11l-4-2.5L3 13z" />
    </svg>
  ),
  bell: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
      <path d="M4 6a3 3 0 0 1 6 0v3l1 1.5H3L4 9z" />
      <path d="M6 12a1 1 0 0 0 2 0" />
    </svg>
  ),
  chevDown: (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <path d="M2 4l3 3 3-3" />
    </svg>
  ),
  arrow: (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M2 6h8M7 3l3 3-3 3" />
    </svg>
  ),
  back: (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M6.5 2L3 5l3.5 3" />
    </svg>
  ),
};
