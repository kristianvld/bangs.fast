/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{ts,tsx,js,jsx,html}"],
  theme: {
    extend: {
      colors: {
        app: {
          bg: "#f3efe7",
          panel: "#fffdf8",
          ink: "#1f2630",
          muted: "#5f6772",
          line: "#d9d1c4",
          brand: "#1e5d4f",
          "brand-soft": "#d9ede7",
          danger: "#9b2c2c",
        },
      },
      fontFamily: {
        sans: ['"IBM Plex Sans"', '"Avenir Next"', '"Segoe UI"', "sans-serif"],
      },
    },
  },
  plugins: [],
};
