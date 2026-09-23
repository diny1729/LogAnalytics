export type ThemeMode = "dark" | "light" | "midnight" | "amethyst" | "amber" | "nordic";

export interface ThemeConfig {
  id: ThemeMode;
  name: string;
  icon: string;
  description: string;
  primaryBg: string;
  surfaceBg: string;
  accent: string;
  textColor: string;
}

export const THEMES: ThemeConfig[] = [
  {
    id: "dark",
    name: "Obsidian Sage",
    icon: "🌲",
    description: "Deep dark obsidian with soft milk luminescence & moss sage accents",
    primaryBg: "#111413",
    surfaceBg: "#181D1A",
    accent: "#5C8750",
    textColor: "#EDEFEA"
  },
  {
    id: "light",
    name: "Milk White",
    icon: "🥛",
    description: "Frosted ivory milk glass with sage borders & olive accents",
    primaryBg: "#FAF7F0",
    surfaceBg: "#FEFCFF",
    accent: "#6F7B60",
    textColor: "#2C332E"
  },
  {
    id: "midnight",
    name: "Midnight Azure",
    icon: "🌌",
    description: "Deep space navy with electric Azure telemetry cyan & blue",
    primaryBg: "#0B0F19",
    surfaceBg: "#111827",
    accent: "#0078D4",
    textColor: "#F1F5F9"
  },
  {
    id: "amethyst",
    name: "Royal Amethyst",
    icon: "🔮",
    description: "Deep royal purple velvet with neon lavender luminescence",
    primaryBg: "#120D1D",
    surfaceBg: "#1A132B",
    accent: "#A855F7",
    textColor: "#F5F3FF"
  },
  {
    id: "amber",
    name: "Sunset Amber",
    icon: "🌅",
    description: "Warm espresso backdrop with glowing golden amber accents",
    primaryBg: "#181310",
    surfaceBg: "#231B17",
    accent: "#F59E0B",
    textColor: "#FEF3C7"
  },
  {
    id: "nordic",
    name: "Arctic Glacier",
    icon: "❄️",
    description: "Deep arctic fjord with polar glacier mint teal accents",
    primaryBg: "#0A1618",
    surfaceBg: "#102226",
    accent: "#14B8A6",
    textColor: "#E0F2FE"
  }
];
