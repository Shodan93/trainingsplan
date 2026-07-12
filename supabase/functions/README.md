# Supabase Edge Functions

Deployt im Projekt `tkxaainjwzvmmdgzsmhh`. Secrets (Anthropic-API-Key, MCP-Key)
liegen in der Tabelle `app_secrets` (RLS ohne Policies → nur Service-Role,
kein Client-Zugriff). **Keine Keys in diesem Repo.**

| Function | Auth | Zweck |
|---|---|---|
| `ai-calories` | Supabase-JWT | Claude schätzt Kalorien aus Freitext, stellt bei unklaren Mengen bis zu 2 Rückfragen |
| `food-search` | Supabase-JWT | Lebensmittel-Textsuche (Open Food Facts, serverseitig wegen CORS/Rate-Limits) |
| `mcp` | `?key=<mcp_key>` | MCP-Server: App-Steuerung aus dem Claude-Chat (Plan, Kalorien, Mahlzeiten, Gewicht) |

## MCP-Connector einrichten (claude.ai)

1. claude.ai → Einstellungen → **Connectors** → **Custom Connector hinzufügen**
2. URL: `https://tkxaainjwzvmmdgzsmhh.supabase.co/functions/v1/mcp?key=<MCP_KEY>`
   (Key steht in `app_secrets` unter `mcp_key`)
3. Keine OAuth-Konfiguration nötig.

Tools: get_overview, get_plan, update_exercise (auch Übungstausch via `new_name`),
add_exercise, remove_exercise, log_calories, log_ingredients (Kochen: Zutaten
mit recherchierten kcal/Makros, optional als Mahlzeit speichern), get_calories,
list_meals, log_saved_meal, log_weight, get_weight, list_workouts.
Jedes Tool nimmt `user: "david" | "svenja"`.

Key rotieren: neuen Wert in `app_secrets.name='mcp_key'` schreiben und die
Connector-URL bei beiden Nutzern aktualisieren.
