# Project Structure (Firebase Edition)

Questa versione del progetto rimuove la dipendenza runtime da Base44 e usa:

- Firebase Auth per autenticazione
- Firestore per il database
- Firebase Storage per upload allegati

Il codice frontend mantiene l'interfaccia `base44` tramite un adapter locale (`src/api/base44Client.js`) per ridurre il refactor.

## 1) Setup Firebase

Crea un progetto Firebase e abilita:

- Authentication (`Email/Password` e opzionale `Google`)
- Firestore Database
- Storage

## 2) Variabili ambiente

Copia `.env.example` in `.env.local` e compila i valori:

```bash
cp .env.example .env.local
```

Variabili richieste:

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`

Variabile opzionale:

- `VITE_EMAIL_WEBHOOK_URL` (endpoint tuo per invio email server-side)

## 3) Avvio locale

Se `npm` non è nel PATH di default:

```bash
export PATH="$HOME/.homebrew/bin:$PATH"
```

```bash
npm install
npm run dev
```

Nota: nel mio ambiente di lavoro qui non sono disponibili `node/npm`, quindi non ho potuto eseguire una build automatica.

## 4) Struttura collezioni Firestore

Il progetto usa queste collection:

- `users`
- `clients`
- `developers`
- `priorityConfigs`
- `tickets`
- `appLogs`

## 5) Note importanti

- `SendEmail` non invia email direttamente dal browser: usa `VITE_EMAIL_WEBHOOK_URL`.
- Gli upload allegati passano da Firebase Storage (`uploads/<uid>/...`).
- Il ruolo utente (`admin`, `analyst`, `developer`) viene salvato in `users.app_role`.

## 6) Deploy rules (consigliato subito)

Le regole sono già nel repo:

- `/Users/rfiorentino/Downloads/project_structure/firestore.rules`
- `/Users/rfiorentino/Downloads/project_structure/storage.rules` (opzionale, solo se usi Firebase Storage)

Deploy con Firebase CLI:

```bash
firebase login
firebase use <YOUR_PROJECT_ID>
firebase deploy --only hosting,firestore:rules
```

Se in futuro abiliti anche Firebase Storage:

```bash
firebase deploy --only hosting,firestore:rules,storage
```

## 7) Primo admin

Dopo il primo login dell’utente, imposta manualmente il ruolo admin su Firestore:

- collection: `users`
- documento: `<uid utente>`
- campo: `app_role = "admin"` (puoi mantenere anche `role = "admin"`)

## 8) Migrazione dati da Base44

Per importare i dati esistenti:

1. Esporta i dataset da Base44 in JSON/CSV.
2. Mappa i campi alle collection sopra (stessi nomi usati nelle pagine).
3. Importa in Firestore con script admin o Firebase console.

Se vuoi, nel prossimo step posso prepararti anche lo script di import automatico partendo dai file export.
