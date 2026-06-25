/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#0b1020',
        surface: '#141a2e',
        surface2: '#1c2440',
        primary: '#0ea5e9',
        accent: '#f59e0b',
        success: '#22c55e',
        danger: '#ef4444'
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'Avenir', 'Helvetica', 'Arial', 'sans-serif']
      },
      keyframes: {
        pop: { '0%': { transform: 'scale(0.8)', opacity: '0' }, '100%': { transform: 'scale(1)', opacity: '1' } },
        slideup: { '0%': { transform: 'translateY(16px)', opacity: '0' }, '100%': { transform: 'translateY(0)', opacity: '1' } }
      },
      animation: {
        pop: 'pop 0.25s ease-out',
        slideup: 'slideup 0.3s ease-out'
      }
    }
  },
  plugins: []
}
