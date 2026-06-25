# 🏋️ Trainingsplan – PWA für David & Svenja

Webbasierte, für das Handy optimierte Trainings-App (am Desktop pflegbar, ohne Installer).
React + Vite + TypeScript + Tailwind, Backend in Supabase, Deploy auf Cloudflare Pages.

## Features

- **Login** (nur angemeldete Nutzer, E-Mail + Passwort)
- **Plan-Modus** – Pläne ansehen & bearbeiten: Übungen, Rep-Ranges, Gewicht pro Satz,
  Tage, Farbcodes, Haltungshinweise, medizinische Hinweise. Partner-Plan einsehbar.
- **Start-/Workout-Modus** – Tag wählen, Übungen abarbeiten, Gewicht + Reps pro Satz
  loggen, **Rest-Timer (Default 90 s, einstellbar)** mit Ton & Vibration.
- **Dynamic Double Progression** – automatischer Hinweis pro Übung („Rep-Range voll →
  Gewicht erhöhen") und Kraftverlauf-Charts.
- **Gamification** – XP/Level, Streaks, Wochenziele, 12 Abzeichen, 200 Motivationstipps.
- **Tracking** – komplette Trainingshistorie, Statistik-Charts, Körpermaße, Ziele,
  privates Tagebuch.
- **PWA** – installierbar („Zum Startbildschirm hinzufügen"), offline-fähiger Shell-Cache.

## Lokal entwickeln

```bash
npm install
cp .env.example .env   # Supabase-Keys sind bereits eingetragen
npm run dev            # http://localhost:5173
npm run build          # Produktion nach dist/
```

## Environment-Variablen

| Variable | Wert |
|---|---|
| `VITE_SUPABASE_URL` | `https://tkxaainjwzvmmdgzsmhh.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | siehe `.env.example` (Supabase publishable key) |

## Login-Konten

| Rolle | E-Mail | Passwort |
|---|---|---|
| Admin (Debug) | `admin@trainingsplan.app` | `admin` |
| David | `d+claude@mumelter.de` | `trainingsplan` |
| Svenja | `svenja.mumelter@gmx.de` | `trainingsplan` |

> Passwörter nach dem ersten Login in der App/Supabase ändern.

## Deploy (Cloudflare Pages)

1. Cloudflare → Workers & Pages → Create → Pages → Connect to Git → `shodan93/trainingsplan`.
2. Build command `npm run build`, Output `dist`, Framework „Vite".
3. Environment-Variablen `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` setzen.
4. Custom domain `trainingsplan.mumelter.org` hinzufügen.

## Datenbank

Schema, RLS-Policies, Funktionen (`finalize_session`, `ddp_suggestion`) und Seed-Daten
(beide Pläne, 200 Tipps, Badges) liegen in Supabase. Migrationen sind über die Supabase-
Historie nachvollziehbar; die Tipp-Seed liegt zusätzlich unter `supabase/seed/`.
