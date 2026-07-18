import type { Config } from 'tailwindcss';

/**
 * Fonology design system.
 *
 * HARD RULE #1 — the storefront is reproduced, not redesigned. Every value
 * below is the CSS variable declared in `src/styles/globals.css`, which in turn
 * is copied VERBATIM from the client-approved prototype (`css/style.css` :root).
 * Tailwind never hardcodes a brand value — it only references `var(--token)` so
 * there is a single source of truth. Admin / employee / auth surfaces (where we
 * have design authority) consume the same tokens, extending the language rather
 * than inventing a new one.
 */
const config: Config = {
  darkMode: ['class'],
  content: [
    './src/app/**/*.{ts,tsx}',
    './src/components/**/*.{ts,tsx}',
    './src/features/**/*.{ts,tsx}',
    './src/lib/**/*.{ts,tsx}',
  ],
  theme: {
    container: {
      center: true,
      padding: '1.5rem',
      screens: { '2xl': '1280px' },
    },
    extend: {
      colors: {
        // ---- raw Fonology brand tokens (storefront source of truth) ----
        paper: 'var(--paper)',
        'paper-2': 'var(--paper-2)',
        card: 'var(--card)',
        void: 'var(--void)',
        'void-2': 'var(--void-2)',
        blush: 'var(--blush)',
        ink: 'var(--ink)',
        'ink-2': 'var(--ink-2)',
        muted: 'var(--muted)',
        bone: 'var(--bone)',
        red: 'var(--red)',
        'red-deep': 'var(--red-deep)',
        ember: 'var(--ember)',
        'red-tint': 'var(--red-tint)',
        line: 'var(--line)',
        'line-strong': 'var(--line-strong)',

        // ---- shadcn/ui semantic aliases (admin / employee / auth) ----
        // These resolve to the brand tokens above so shadcn components are
        // on-brand out of the box. NOTE: mapped to raw `var(--x)` (not the
        // stock `hsl(var(--x))`), matching how our globals.css defines them.
        border: 'var(--border)',
        input: 'var(--input)',
        ring: 'var(--ring)',
        background: 'var(--background)',
        foreground: 'var(--foreground)',
        primary: {
          DEFAULT: 'var(--primary)',
          foreground: 'var(--primary-foreground)',
        },
        secondary: {
          DEFAULT: 'var(--secondary)',
          foreground: 'var(--secondary-foreground)',
        },
        destructive: {
          DEFAULT: 'var(--destructive)',
          foreground: 'var(--destructive-foreground)',
        },
        'muted-ui': {
          DEFAULT: 'var(--muted-bg)',
          foreground: 'var(--muted-foreground)',
        },
        accent: {
          DEFAULT: 'var(--accent)',
          foreground: 'var(--accent-foreground)',
        },
        popover: {
          DEFAULT: 'var(--popover)',
          foreground: 'var(--popover-foreground)',
        },
        'card-ui': {
          DEFAULT: 'var(--card-bg)',
          foreground: 'var(--card-foreground)',
        },
        success: 'var(--success)',
        warning: 'var(--warning)',
      },
      fontFamily: {
        display: 'var(--f-display)',
        body: 'var(--f-body)',
        serif: 'var(--f-serif)',
        sans: 'var(--f-body)',
      },
      borderRadius: {
        tile: 'var(--r-tile)', // 22px — storefront tiles/cards
        ui: 'var(--r-ui)', // 14px — inputs/buttons
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      spacing: {
        nav: 'var(--nav-h)', // 76px sticky nav height
      },
      transitionTimingFunction: {
        out: 'var(--e-out)', // cubic-bezier(.16,1,.3,1)
        inout: 'var(--e-inout)', // cubic-bezier(.87,0,.13,1)
      },
      boxShadow: {
        tile: '0 2px 6px rgba(24,16,16,.06), 0 16px 34px rgba(24,16,16,.12)',
        drawer: '-30px 0 70px rgba(21,8,7,.3)',
        card: '0 1px 3px rgba(122,17,4,.04), 0 14px 34px rgba(122,17,4,.07)',
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
        bump: { '40%': { transform: 'scale(1.45)' } },
        spin: { to: { transform: 'rotate(360deg)' } },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        bump: 'bump 0.45s var(--e-out)',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};

export default config;
