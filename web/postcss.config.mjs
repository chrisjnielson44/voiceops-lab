/** @type {import('postcss-load-config').Config} */
const config = {
  plugins: {
    // Tailwind v4 moved the PostCSS plugin to its own package; it also handles
    // vendor prefixing, so autoprefixer is no longer needed.
    "@tailwindcss/postcss": {},
  },
};

export default config;
