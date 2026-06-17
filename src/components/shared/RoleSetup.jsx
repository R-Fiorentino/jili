import React, { useState } from "react";
import { appClient } from "@/api/appClient";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { BarChart2, Code2, ArrowLeft } from "lucide-react";

export default function RoleSetup({ onDone }) {
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState("choose"); // "choose" | "analyst_name" | "dev_name"
  const [analystName, setAnalystName] = useState("");
  const [devName, setDevName] = useState("");
  const [error, setError] = useState("");

  const handleLogout = async () => {
    setError("");
    setLoading(true);
    try {
      await appClient.auth.logout();
    } catch (err) {
      setError(err?.message || "Logout non riuscito.");
      setLoading(false);
    }
  };

  const chooseAnalystConfirm = async () => {
    if (!analystName.trim()) return;
    setError("");
    setLoading(true);
    try {
      const user = await appClient.auth.me();
      await appClient.auth.updateMe({
        full_name: analystName.trim() || user?.full_name || user?.email || "Analyst",
        active: true,
        app_role: "analyst",
        role: "analyst",
      });
      onDone("analyst");
    } catch (err) {
      setError(err?.message || "Impossibile aggiornare il ruolo. Controlla le regole Firestore.");
      setLoading(false);
    }
  };

  const chooseDevConfirm = async () => {
    if (!devName.trim()) return;
    setError("");
    setLoading(true);
    try {
      const user = await appClient.auth.me();

      // 1) Always set role first so onboarding can continue
      await appClient.auth.updateMe({ app_role: "developer", role: "developer" });

      // 2) Try to create developer card (non-blocking)
      try {
        await appClient.entities.Developer.create({
          name: devName.trim(),
          email: user.email,
          daily_capacity: 8,
          active: true,
        });
      } catch (devCreateError) {
        console.warn("Developer profile creation skipped:", devCreateError);
      }

      onDone("developer");
    } catch (err) {
      setError(err?.message || "Impossibile completare setup developer.");
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="max-w-md w-full">
        <div className="flex justify-end mb-3">
          <Button
            variant="outline"
            onClick={handleLogout}
            disabled={loading}
            className="h-8 text-xs"
          >
            Esci
          </Button>
        </div>

        {step === "choose" && (
          <>
            <div className="text-center mb-8">
              <h1 className="text-2xl font-bold text-gray-900">Benvenuto in J-ili</h1>
              <p className="text-gray-500 mt-2">Come utilizzerai la piattaforma?</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <button
                onClick={() => setStep("analyst_name")}
                disabled={loading}
                className="bg-white border-2 border-gray-200 hover:border-violet-500 hover:shadow-md rounded-2xl p-6 text-left transition-all group"
              >
                <div className="w-12 h-12 rounded-xl bg-violet-100 flex items-center justify-center mb-4 group-hover:bg-violet-200 transition-colors">
                  <BarChart2 className="w-6 h-6 text-violet-600" />
                </div>
                <h3 className="font-bold text-gray-900 text-lg">Analyst</h3>
                <p className="text-sm text-gray-500 mt-1">Creo ticket, assegno task e monitoro le pipeline</p>
              </button>

              <button
                onClick={() => setStep("dev_name")}
                disabled={loading}
                className="bg-white border-2 border-gray-200 hover:border-blue-500 hover:shadow-md rounded-2xl p-6 text-left transition-all group"
              >
                <div className="w-12 h-12 rounded-xl bg-blue-100 flex items-center justify-center mb-4 group-hover:bg-blue-200 transition-colors">
                  <Code2 className="w-6 h-6 text-blue-600" />
                </div>
                <h3 className="font-bold text-gray-900 text-lg">Developer</h3>
                <p className="text-sm text-gray-500 mt-1">Lavoro sui ticket assegnati e gestisco le mie stime</p>
              </button>
            </div>
          </>
        )}

        {step === "analyst_name" && (
          <>
            <button
              onClick={() => setStep("choose")}
              className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 mb-6 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" /> Indietro
            </button>
            <div className="text-center mb-8">
              <div className="w-14 h-14 rounded-2xl bg-violet-100 flex items-center justify-center mx-auto mb-4">
                <BarChart2 className="w-7 h-7 text-violet-600" />
              </div>
              <h1 className="text-2xl font-bold text-gray-900">Il tuo nome</h1>
              <p className="text-gray-500 mt-2">Come vuoi essere visualizzato come analyst?</p>
            </div>
            <Input
              value={analystName}
              onChange={e => setAnalystName(e.target.value)}
              placeholder="Es. Mario Rossi"
              className="mb-4 h-11 text-base"
              onKeyDown={e => e.key === "Enter" && chooseAnalystConfirm()}
              autoFocus
            />
            <Button
              onClick={chooseAnalystConfirm}
              disabled={!analystName.trim() || loading}
              className="w-full h-11 bg-violet-600 hover:bg-violet-700 text-white font-semibold"
            >
              {loading ? "Configurazione..." : "Inizia come Analyst"}
            </Button>
          </>
        )}

        {step === "dev_name" && (
          <>
            <button
              onClick={() => setStep("choose")}
              className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 mb-6 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" /> Indietro
            </button>
            <div className="text-center mb-8">
              <div className="w-14 h-14 rounded-2xl bg-blue-100 flex items-center justify-center mx-auto mb-4">
                <Code2 className="w-7 h-7 text-blue-600" />
              </div>
              <h1 className="text-2xl font-bold text-gray-900">Il tuo nome</h1>
              <p className="text-gray-500 mt-2">Come vuoi essere visualizzato nella pipeline?</p>
            </div>
            <Input
              value={devName}
              onChange={e => setDevName(e.target.value)}
              placeholder="Es. Mario Rossi"
              className="mb-4 h-11 text-base"
              onKeyDown={e => e.key === "Enter" && chooseDevConfirm()}
              autoFocus
            />
            <Button
              onClick={chooseDevConfirm}
              disabled={!devName.trim() || loading}
              className="w-full h-11 bg-blue-600 hover:bg-blue-700 text-white font-semibold"
            >
              {loading ? "Configurazione..." : "Inizia come Developer"}
            </Button>
          </>
        )}

        {error && (
          <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </div>
        )}

      </div>
    </div>
  );
}
