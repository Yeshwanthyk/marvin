import { createContext, useContext, type ParentProps } from "solid-js"
import { colors, type ColorKey } from "../utils/colors.js"

export interface Theme {
  colors: typeof colors
  get: (key: ColorKey) => string
}

const ThemeContext = createContext<Theme>()

export function ThemeProvider(props: ParentProps) {
  const theme: Theme = {
    colors,
    get: (key: ColorKey) => colors[key],
  }

  return (
    <ThemeContext.Provider value={theme}>
      {props.children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider")
  return ctx
}
