import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-bricolage)', 'system-ui', '-apple-system', 'sans-serif'],
      },
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        primary: "#faf9f8",
        surface: "#ffffff",
        "border-light": "#e8e8e4",
        "text-primary": "#1a1a18",
        "text-muted": "#6b6b63",
        green: "#1a7f4b",
        red: "#c7293a",
        amber: "#92650a",
      },
      boxShadow: {
        card: '0 2px 16px rgba(0,0,0,0.06)',
        'card-hover': '0 4px 24px rgba(0,0,0,0.10)',
      },
      borderRadius: {
        card: '20px',
      },
    },
  },
  plugins: [],
};
export default config;
