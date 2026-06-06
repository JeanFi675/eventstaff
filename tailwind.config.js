/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './admin.html',
    './debit.html',
    './scanner-tshirt.html',
    './src/**/*.{js,ts,jsx,tsx,html}',
  ],
  theme: {
    extend: {
      colors: {
        'brutal-black': '#000000',
        'brutal-ice': '#8bbfd5',
        'brutal-white': '#ffffff',
      },
      fontFamily: {
        body: ['Space Grotesk', 'sans-serif'],
        heading: ['Inter', 'sans-serif'],
      },
      boxShadow: {
        brutal: '4px 4px 0px #000000',
        'brutal-sm': '2px 2px 0px #000000',
        'brutal-hover': '1px 1px 0px #000000',
      },
    },
  },
  plugins: [],
};
