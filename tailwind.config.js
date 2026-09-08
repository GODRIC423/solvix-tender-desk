/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './connector/index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Carries over the dark palette from the original single-file app so the
        // TMS and the connector still look like the same product.
        ink: {
          950: '#0b0f14',
          900: '#0f141b',
          850: '#141b24',
          800: '#1a222d',
          700: '#243040',
          600: '#324256',
          500: '#4a5f78',
        },
        accent: '#4da3ff',
        // Shared 4-tier band palette: used by BOTH QC confidence and load urgency
        // so the colors mean the same thing everywhere in the product.
        band: {
          green: '#1f9d55',
          yellow: '#d9a406',
          orange: '#e0700b',
          red: '#d3392b',
        },
      },
    },
  },
  plugins: [],
}
