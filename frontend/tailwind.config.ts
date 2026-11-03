import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "#F6F7F9",
        surface: "#FFFFFF",
        "surface-muted": "#F9FAFB",
        "surface-sunken": "#F1F3F6",
        primary: {
          50: "#F1F5F9",
          100: "#E4EBF3",
          200: "#C7D5E5",
          300: "#A3B8D0",
          400: "#7E97B4",
          500: "#496A91",
          600: "#3D5A7D",
          700: "#334A68",
          800: "#2A3C54",
          900: "#223142",
        },
        ink: {
          DEFAULT: "#273444",
          soft: "#445268",
          muted: "#5F6D7E",
          faint: "#8A97A6",
        },
        line: {
          DEFAULT: "#E2E6EB",
          strong: "#CDD4DC",
          faint: "#EDF0F3",
        },
        sage: {
          50: "#F2F7F3",
          100: "#E3EFE5",
          500: "#5C7F6F",
          600: "#4C6C5E",
          700: "#3D574C",
        },
        warning: {
          50: "#FBF6EC",
          100: "#F6EBD4",
          500: "#A7793F",
          600: "#8F6633",
        },
        danger: {
          50: "#FBF1F0",
          100: "#F6E1DF",
          500: "#A65B55",
          600: "#8D4B46",
        },
        info: {
          50: "#F1F4F8",
          500: "#496A91",
        },
      },
      fontFamily: {
        sans: ["Manrope Variable", "Manrope", "Inter", "system-ui", "sans-serif"],
        mono: ["IBM Plex Mono", "ui-monospace", "monospace"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(39, 52, 68, 0.04), 0 1px 3px rgba(39, 52, 68, 0.03)",
        popover: "0 12px 32px -12px rgba(39, 52, 68, 0.24), 0 2px 8px rgba(39, 52, 68, 0.06)",
        focus: "0 0 0 3px rgba(73, 106, 145, 0.18)",
      },
      borderRadius: {
        card: "10px",
      },
      keyframes: {
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        "slide-up": {
          "0%": { opacity: "0", transform: "translateY(6px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-in": "fade-in .16s ease-out both",
        "slide-up": "slide-up .2s ease-out both",
      },
    },
  },
  plugins: [],
} satisfies Config;
