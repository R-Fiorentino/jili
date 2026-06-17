import React, { useState } from "react";
import { appClient } from "@/api/appClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

const MIN_PASSWORD_LENGTH = 6;
const SIGNUP_PASSPHRASE = (import.meta.env.VITE_SIGNUP_PASSPHRASE || "").trim();

export default function LoginScreen() {
  const [mode, setMode] = useState("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [signupPassphrase, setSignupPassphrase] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const isSignUp = mode === "signup";

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");

    if (!email || !password) {
      setError("Inserisci email e password.");
      return;
    }

    if (isSignUp && password.length < MIN_PASSWORD_LENGTH) {
      setError("La password deve avere almeno 6 caratteri.");
      return;
    }

    if (isSignUp && !SIGNUP_PASSPHRASE) {
      setError("Registrazione disabilitata: configura la parola chiave di accesso.");
      return;
    }

    if (isSignUp && signupPassphrase.trim() !== SIGNUP_PASSPHRASE) {
      setError("Parola chiave non valida.");
      return;
    }

    setLoading(true);

    try {
      if (isSignUp) {
        await appClient.auth.signUpWithEmail(
          email,
          password,
          fullName.trim(),
          signupPassphrase.trim()
        );
      } else {
        await appClient.auth.signInWithEmail(email, password);
      }
    } catch (submitError) {
      setError(submitError?.message || "Autenticazione non riuscita.");
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setError("");
    setLoading(true);

    try {
      await appClient.auth.signInWithGoogle();
    } catch (googleError) {
      setError(googleError?.message || "Login Google non riuscito.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md border border-border bg-card shadow-lg">
        <CardHeader className="space-y-1">
          <CardTitle className="text-xl font-bold text-foreground">
            {isSignUp ? "Crea account" : "Accedi"}
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            {isSignUp
              ? "Crea un utente e imposta il tuo ruolo al primo accesso."
              : "Accedi per continuare a usare la pipeline."}
          </p>
        </CardHeader>

        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {isSignUp && (
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-muted-foreground">Nome completo</Label>
                <Input
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                  placeholder="Mario Rossi"
                />
              </div>
            )}

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-muted-foreground">Email</Label>
              <Input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="nome@azienda.com"
                autoComplete="email"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold text-muted-foreground">Password</Label>
              <Input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="••••••••"
                autoComplete={isSignUp ? "new-password" : "current-password"}
              />
            </div>

            {isSignUp && (
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-muted-foreground">
                  Parola chiave registrazione
                </Label>
                <Input
                  type="password"
                  value={signupPassphrase}
                  onChange={(event) => setSignupPassphrase(event.target.value)}
                  placeholder="Inserisci la parola chiave"
                  autoComplete="off"
                />
              </div>
            )}

            {error && (
              <div className="rounded-md border border-red-200 bg-red-50 dark:border-red-500/40 dark:bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-300">
                {error}
              </div>
            )}

            <Button type="submit" disabled={loading} className="w-full">
              {loading && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
              {isSignUp ? "Crea account" : "Accedi"}
            </Button>
          </form>

          <div className="mt-4 space-y-2">
            <Button
              type="button"
              variant="outline"
              disabled={loading}
              onClick={handleGoogleLogin}
              className="w-full"
            >
              Continua con Google
            </Button>

            <button
              type="button"
              className="w-full text-xs text-muted-foreground hover:text-foreground"
              onClick={() => {
                setMode(isSignUp ? "signin" : "signup");
                setError("");
                setSignupPassphrase("");
              }}
            >
              {isSignUp
                ? "Hai già un account? Accedi"
                : "Non hai un account? Registrati"}
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
