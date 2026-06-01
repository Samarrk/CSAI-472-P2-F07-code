/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,jsx,ts,tsx}',
    './src/**/*.{js,jsx,ts,tsx}',
  ],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#006565',
          container: '#008080',
          on: '#ffffff',
        },
        secondary: {
          DEFAULT: '#006c4f',
          container: '#80f9ca',
          on: '#ffffff',
        },
        tertiary: {
          DEFAULT: '#775400',
          container: '#976b00',
          on: '#ffffff',
        },
        surface: {
          DEFAULT: '#f7fafa',
          lowest: '#ffffff',
          low: '#f1f4f4',
          container: '#ebeeee',
          high: '#e6e9e9',
          highest: '#e0e3e3',
          on: '#181c1d',
          variant: '#e0e3e3',
        },
        outline: {
          DEFAULT: '#6e7979',
          variant: '#bdc9c8',
        },
        error: {
          DEFAULT: '#ba1a1a',
          container: '#ffdad6',
          on: '#ffffff',
        },
      },
      borderRadius: {
        sm: '4px',
        DEFAULT: '8px',
        md: '12px',
        lg: '16px',
        xl: '24px',
        full: '9999px',
      },
    },
  },
  plugins: [],
};
