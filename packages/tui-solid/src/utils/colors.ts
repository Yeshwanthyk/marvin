/**
 * Default color palette - editorial theme
 */
export const colors = {
  // Text
  text: "#e8e4dc",
  textDim: "#6b6b70",
  textStrong: "#ffffff",

  // Accent
  accent: "#ff6b5b",
  accentAlt: "#5cecc6",

  // Code/syntax
  code: "#5cecc6",
  codeAlt: "#d08770",

  // Borders
  border: "#3a3a40",
  borderStrong: "#4a4a5a",

  // Backgrounds
  bg: "#0d1117",
  bgRaised: "#1a1b26",

  // Tool status
  toolPending: "#2d2d3a",
  toolSuccess: "#1a2a1a",
  toolError: "#2a1a1a",

  // Tool types
  toolBash: "#a3be8c",
  toolRead: "#88c0d0",
  toolWrite: "#d08770",
  toolEdit: "#b48ead",

  // Info/status
  info: "#88c0d0",
  warning: "#ffcc00",
  error: "#ff6b5b",
  success: "#5cecc6",
} as const

export type ColorKey = keyof typeof colors
