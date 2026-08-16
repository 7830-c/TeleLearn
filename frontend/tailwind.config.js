/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: '#f7f9ff',
        surface: '#f7f9ff',
        primary: '#1a73e8',
        'primary-fixed': '#d8e2ff',
        'on-surface': '#181c20',
        'outline-variant': '#c1c6d6',
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
