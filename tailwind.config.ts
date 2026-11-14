import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        coffee: {
          900: "#1A120B",
          800: "#241A10",
          700: "#3A2A1A",
          600: "#5C3D24",
          500: "#8B5E34",
          400: "#C08A3E",
          300: "#D9A866",
          200: "#EFD9B4",
          100: "#F7EBD7",
          50: "#FFF8F0",
        },
      },
      fontFamily: { sans: ["var(--font-sans)", "system-ui", "sans-serif"] },
      boxShadow: { card: "0 8px 30px rgba(26,18,11,0.12)" },
    },
  },
  plugins: [],
};
export default config;
