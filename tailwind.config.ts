import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        // Primary brand blue (audit direction): 600 = #2563EB, hover 700 = #1D4ED8.
        // A calm, professional blue family — not neon, not navy-dark.
        brand: {
          50: "#eff6ff",
          100: "#dbeafe",
          200: "#bfdbfe",
          300: "#93c5fd",
          400: "#60a5fa",
          500: "#3b82f6",
          600: "#2563eb",
          700: "#1d4ed8",
          800: "#1e40af",
          900: "#1e3a8a",
        },
        // Semantic surface tokens so pages never sit on harsh pure white.
        canvas: "#f9fafb", // main page background (soft off-white)
        section: "#f2f6fa", // alternate, blue-tinted section background
        surface: "#ffffff", // raised cards/panels
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
      },
      boxShadow: {
        // Flat, modern elevation: a hairline rest shadow and a gentle hover lift.
        card: "0 1px 2px 0 rgba(15, 23, 42, 0.05)",
        "card-hover": "0 4px 6px -1px rgba(15, 23, 42, 0.10)",
      },
      maxWidth: {
        content: "70rem",
        // Wider container for the conversion/review flow so the transaction table
        // can span most of a normal desktop without horizontal scrolling.
        wide: "90rem",
        // Centered, focused workspace for the review page: wide enough for the
        // transaction table + a compact balance sidebar, but narrow enough to leave
        // clear whitespace on both sides at normal desktop widths (~1200px).
        review: "75rem",
      },
    },
  },
  plugins: [],
};

export default config;
