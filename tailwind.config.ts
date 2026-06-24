import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eef6ff",
          100: "#d9eaff",
          200: "#bcd9ff",
          300: "#8ec1ff",
          400: "#599dff",
          500: "#3377f6",
          600: "#1f57db",
          700: "#1a45b0",
          800: "#1b3c8c",
          900: "#1c376f",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
      },
      maxWidth: {
        content: "72rem",
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
