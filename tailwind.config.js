/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          black: '#1A1A1A',
          charcoal: '#2D2D2D',
          'warm-gray': '#4A4A4A',
          'mid-gray': '#7A7A7A',
          'light-gray': '#E8E5E0',
          'off-white': '#F5F3EF',
          'warm-white': '#FAF8F5',
          cream: '#FFFDF9',
          green: '#2D6A4F',
          'green-light': '#40916C',
          'green-pale': '#D8F3DC',
          purple: '#7B2D8E',
          'purple-light': '#C77DFF',
          'purple-pale': '#F0DDF5',
          coral: '#E07A5F',
          gold: '#F9C74F',
          red: '#D62828',
        }
      },
      fontFamily: {
        serif: ["'Instrument Serif'", 'Georgia', 'serif'],
        sans: ["'DM Sans'", 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        pill: '999px',
      },
    },
  },
  plugins: [],
}
