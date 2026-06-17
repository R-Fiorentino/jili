import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight, Compass, Sparkles } from "lucide-react";
import { createPageUrl } from "@/utils";
import { Button } from "@/components/ui/button";

const TUTORIAL_VERSION = "v2";
const SPOTLIGHT_PADDING = 10;
const TOOLTIP_WIDTH = 380;
const VIEWPORT_PADDING = 24;
const FALLBACK_TOOLTIP_HEIGHT = 360;

const ROLE_TUTORIAL_STEPS = {
  admin: [
    {
      page: "MyTickets",
      target: "my-tickets-scope",
      title: "Qui filtri il perimetro",
      description: "Puoi vedere solo i ticket che ti interessano o allargare la vista all'operativita completa.",
      note: "E il punto piu rapido per partire e capire cosa richiede attenzione.",
    },
    {
      page: "MyTickets",
      target: "my-tickets-list",
      title: "Qui trovi i ticket da seguire",
      description: "La tabella e filtrabile e ordinabile. Da qui apri il ticket corretto e segui avanzamenti o blocchi.",
      note: "L'inizio presa in carico ti aiuta a capire cosa partira prima.",
    },
    {
      page: "CreateTicket",
      target: "create-ticket-context",
      title: "Qui apri un nuovo ticket",
      description: "Cliente, deadline ed effort previsto definiscono come il ticket entra nel flusso.",
      note: "Compila bene questi campi per avere una pianificazione piu pulita.",
    },
    {
      page: "DevPipeline",
      target: "pipeline-filters",
      title: "Qui filtri la pipeline",
      description: "Puoi scegliere developer e clienti da vedere e tenere pulita la settimana.",
      note: "I filtri cambiano solo la vista, non i dati salvati.",
    },
    {
      page: "DevPipeline",
      target: "pipeline-grid",
      title: "Qui leggi la settimana",
      description: "La griglia mostra ticket, blocchi e spazi liberi in modo operativo.",
      note: "Aprendo una card entri subito nel ticket giusto.",
    },
    {
      page: "Clients",
      target: "clients-overview",
      title: "Qui controlli i clienti",
      description: "Qui trovi ownership, team e impatto operativo di ogni cliente.",
      note: "E il posto giusto per capire chi assorbe piu lavoro.",
    },
    {
      page: "Settings",
      target: "nav-Settings",
      title: "Qui controlli le regole di sistema",
      description: "Le impostazioni servono a regolare priorita, industry e regole condivise.",
      note: "Puoi riaprire questo tour quando vuoi.",
    },
  ],
  analyst: [
    {
      page: "MyTickets",
      target: "my-tickets-scope",
      title: "Qui filtri il perimetro",
      description: "Puoi vedere solo i ticket che ti interessano o allargare la vista al backlog operativo.",
      note: "Il toggle serve a restare concentrato quando il volume cresce.",
    },
    {
      page: "MyTickets",
      target: "my-tickets-list",
      title: "Qui trovi i ticket da seguire",
      description: "La tabella e filtrabile e ordinabile. Da qui apri il ticket corretto e segui avanzamenti o blocchi.",
      note: "L'inizio presa in carico ti aiuta a capire cosa partira prima.",
    },
    {
      page: "CreateTicket",
      target: "create-ticket-brief",
      title: "Qui descrivi il test",
      description: "Descrizione e tracciamenti richiesti formano il brief operativo del ticket.",
      note: "Piu il brief e chiaro, meno passaggi a vuoto avrai dopo.",
    },
    {
      page: "CreateTicket",
      target: "create-ticket-reference",
      title: "Qui aggiungi le reference",
      description: "Puoi inserire link utili come Figma, URL pagina, brief o immagini esterne.",
      note: "Se non servono reference, puoi segnalarlo e lasciare il ticket pulito.",
    },
    {
      page: "ReportedTests",
      target: "reported-chart",
      title: "Qui leggi i test riportati",
      description: "Questa pagina aggrega i test chiusi e mostra outcome e performance nel tempo.",
      note: "Ti aiuta a capire cosa ha vinto, perso o non ha dato significativita.",
    },
    {
      page: "Clients",
      target: "clients-table",
      title: "Qui controlli team e ownership",
      description: "La tabella clienti ti mostra chi segue ogni account e come e composto il team.",
      note: "Serve per verificare che i ticket finiscano nel team corretto.",
    },
  ],
  developer: [
    {
      page: "DevPipeline",
      target: "pipeline-filters",
      title: "Qui scegli cosa vedere",
      description: "Puoi cambiare pipeline visibile e filtrare i clienti per tenere pulita la settimana.",
      note: "Usa questi filtri quando vuoi concentrarti su un progetto specifico.",
    },
    {
      page: "DevPipeline",
      target: "pipeline-grid",
      title: "Qui lavori sulla settimana",
      description: "La griglia mostra ticket, blocchi e buchi reali nella pianificazione.",
      note: "I blocchi di disponibilita vincono sempre sui ticket.",
    },
    {
      page: "Availability",
      target: "availability-form",
      title: "Qui blocchi gli slot",
      description: "Assenze, call o attivita ricorrenti si inseriscono qui e proteggono la pipeline.",
      note: "Usa slot singoli per eccezioni e ricorrenti per attivita fisse.",
    },
    {
      page: "MyTickets",
      target: "my-tickets-list",
      title: "Qui ritrovi i ticket",
      description: "I miei ticket mostra attivi e completati, cosi riapri rapidamente quello che ti serve.",
      note: "Dal ticket puoi aggiornare effort, commenti e segnalare blocchi.",
    },
  ],
  tech_supervisor: [
    {
      page: "DevPipeline",
      target: "pipeline-filters",
      title: "Qui filtri la vista operativa",
      description: "Puoi cambiare pipeline visibile e leggere meglio il carico del team.",
      note: "Da qui entri rapidamente nei ticket operativi quando serve.",
    },
    {
      page: "DevPipeline",
      target: "pipeline-grid",
      title: "Qui leggi carico e priorita",
      description: "La griglia ti aiuta a capire se ticket, blocchi ed effort sono allineati.",
      note: "Se serve intervenire, fallo prima che il ticket parta davvero.",
    },
    {
      page: "Clients",
      target: "clients-table",
      title: "Qui controlli i clienti",
      description: "Qui vedi ownership e team dei clienti e controlli se il setup e corretto.",
      note: "Ti serve per capire se il lavoro sta andando al team giusto.",
    },
    {
      page: "MyTickets",
      target: "my-tickets-list",
      title: "Qui segui i ticket",
      description: "I miei ticket ti aiuta a ritrovare velocemente i ticket da commentare o riallineare.",
      note: "Le notifiche ti avvisano quando qualcosa cambia.",
    },
  ],
};

function getTutorialStorageKey(userId, role) {
  return `app_tutorial_seen:${TUTORIAL_VERSION}:${userId}:${role}`;
}

export function hasSeenTutorial(userId, role) {
  if (typeof window === "undefined" || !userId || !role) return false;
  return window.localStorage.getItem(getTutorialStorageKey(userId, role)) === "1";
}

export function markTutorialSeen(userId, role) {
  if (typeof window === "undefined" || !userId || !role) return;
  window.localStorage.setItem(getTutorialStorageKey(userId, role), "1");
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getTooltipPosition(rect, measuredHeight = FALLBACK_TOOLTIP_HEIGHT) {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const width = Math.min(TOOLTIP_WIDTH, viewportWidth - VIEWPORT_PADDING * 2);
  const maxHeight = viewportHeight - VIEWPORT_PADDING * 2;
  const effectiveHeight = Math.min(Math.max(measuredHeight, FALLBACK_TOOLTIP_HEIGHT), maxHeight);

  if (!rect) {
    return {
      left: VIEWPORT_PADDING,
      top: VIEWPORT_PADDING,
      width,
      maxHeight,
    };
  }

  const spaceRight = viewportWidth - rect.right - VIEWPORT_PADDING;
  const spaceLeft = rect.left - VIEWPORT_PADDING;
  const preferredLeft =
    spaceRight >= width + 24
      ? rect.right + 20
      : spaceLeft >= width + 24
        ? rect.left - width - 20
        : clamp(rect.left, VIEWPORT_PADDING, viewportWidth - width - VIEWPORT_PADDING);

  const preferredTop = rect.top;
  const top = clamp(
    preferredTop,
    VIEWPORT_PADDING,
    Math.max(VIEWPORT_PADDING, viewportHeight - effectiveHeight - VIEWPORT_PADDING),
  );

  return {
    left: preferredLeft,
    top,
    width,
    maxHeight,
  };
}

export default function AppTutorial({ open, onOpenChange, user, currentPageName }) {
  const navigate = useNavigate();
  const [stepIndex, setStepIndex] = useState(0);
  const [targetRect, setTargetRect] = useState(null);
  const [isTargetReady, setIsTargetReady] = useState(false);
  const [tooltipHeight, setTooltipHeight] = useState(FALLBACK_TOOLTIP_HEIGHT);
  const scrolledStepRef = useRef("");
  const tooltipRef = useRef(null);

  const role = user?.role || "developer";
  const steps = useMemo(() => ROLE_TUTORIAL_STEPS[role] || ROLE_TUTORIAL_STEPS.developer, [role]);
  const currentStep = steps[stepIndex] || null;
  const targetSelector = currentStep?.target ? `[data-tour="${currentStep.target}"]` : null;

  useEffect(() => {
    if (open) {
      setStepIndex(0);
    }
  }, [open, role]);

  useEffect(() => {
    if (!open || !currentStep?.page) return;
    if (currentPageName === currentStep.page) return;
    navigate(createPageUrl(currentStep.page));
  }, [open, currentStep?.page, currentPageName, navigate]);

  useEffect(() => {
    if (!open || !currentStep) return;

    const stepKey = `${currentStep.page}:${currentStep.target}`;
    const updateTarget = () => {
      if (currentStep.page && currentPageName !== currentStep.page) {
        setTargetRect(null);
        setIsTargetReady(false);
        return;
      }

      const target = targetSelector ? document.querySelector(targetSelector) : null;
      if (!target) {
        setTargetRect(null);
        setIsTargetReady(false);
        return;
      }

      if (scrolledStepRef.current !== stepKey) {
        target.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
        scrolledStepRef.current = stepKey;
      }

      const rect = target.getBoundingClientRect();
      setTargetRect({
        left: clamp(rect.left - SPOTLIGHT_PADDING, 0, window.innerWidth),
        top: clamp(rect.top - SPOTLIGHT_PADDING, 0, window.innerHeight),
        right: clamp(rect.right + SPOTLIGHT_PADDING, 0, window.innerWidth),
        bottom: clamp(rect.bottom + SPOTLIGHT_PADDING, 0, window.innerHeight),
        width: Math.max(0, rect.width + SPOTLIGHT_PADDING * 2),
        height: Math.max(0, rect.height + SPOTLIGHT_PADDING * 2),
      });
      setIsTargetReady(true);
    };

    updateTarget();
    const intervalId = window.setInterval(updateTarget, 250);
    window.addEventListener("resize", updateTarget);
    window.addEventListener("scroll", updateTarget, true);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("resize", updateTarget);
      window.removeEventListener("scroll", updateTarget, true);
    };
  }, [open, currentStep, currentPageName, targetSelector]);

  useEffect(() => {
    if (!open) return;

    const measureTooltip = () => {
      if (!tooltipRef.current) return;
      const rect = tooltipRef.current.getBoundingClientRect();
      if (rect.height > 0) {
        setTooltipHeight(rect.height);
      }
    };

    measureTooltip();
    const animationId = window.requestAnimationFrame(measureTooltip);
    window.addEventListener("resize", measureTooltip);

    return () => {
      window.cancelAnimationFrame(animationId);
      window.removeEventListener("resize", measureTooltip);
    };
  }, [open, stepIndex, currentPageName, currentStep?.title, currentStep?.description, currentStep?.note]);

  if (!open || !currentStep) return null;

  const tooltipPosition = getTooltipPosition(targetRect, tooltipHeight);
  const isLastStep = stepIndex === steps.length - 1;

  return (
    <div className="fixed inset-0 z-[90]">
      {targetRect ? (
        <>
          <div className="fixed inset-x-0 top-0 bg-slate-950/68 backdrop-blur-[1.5px]" style={{ height: targetRect.top }} />
          <div className="fixed inset-x-0 bottom-0 bg-slate-950/68 backdrop-blur-[1.5px]" style={{ top: targetRect.bottom }} />
          <div
            className="fixed left-0 bg-slate-950/68 backdrop-blur-[1.5px]"
            style={{ top: targetRect.top, width: targetRect.left, height: targetRect.height }}
          />
          <div
            className="fixed right-0 bg-slate-950/68 backdrop-blur-[1.5px]"
            style={{ top: targetRect.top, left: targetRect.right, height: targetRect.height }}
          />
          <div
            className="pointer-events-none fixed rounded-[24px] border border-primary/70 shadow-[0_0_0_1px_rgba(255,255,255,0.08),0_0_0_9999px_rgba(0,0,0,0)] transition-all duration-150"
            style={{
              left: targetRect.left,
              top: targetRect.top,
              width: targetRect.width,
              height: targetRect.height,
              boxShadow: "0 0 0 1px rgba(124, 58, 237, 0.55), 0 18px 48px rgba(15, 23, 42, 0.28)",
            }}
          />
        </>
      ) : (
        <div className="fixed inset-0 bg-slate-950/68 backdrop-blur-[1.5px]" />
      )}

      <div
        ref={tooltipRef}
        className="fixed z-[91] rounded-[28px] border border-border/80 bg-background/96 p-5 shadow-[0_28px_70px_rgba(15,23,42,0.35)] backdrop-blur-xl"
        style={{
          left: tooltipPosition.left,
          top: tooltipPosition.top,
          width: tooltipPosition.width,
          maxWidth: `calc(100vw - ${VIEWPORT_PADDING * 2}px)`,
          maxHeight: tooltipPosition.maxHeight,
        }}
      >
        <div className="flex max-h-full min-h-0 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            <div className="flex items-start gap-3">
              <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/12 text-primary">
                <Compass className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="app-kicker">Tutorial guidato</p>
                <h3 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">{currentStep.title}</h3>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">{currentStep.description}</p>
                <p className="mt-3 text-sm leading-6 text-foreground/90">{currentStep.note}</p>
              </div>
            </div>
          </div>

          <div className="mt-4 flex shrink-0 flex-col gap-3 border-t border-border/70 pt-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              <span>
                Step {stepIndex + 1} di {steps.length}
              </span>
              {!isTargetReady && <span>· sto portandoti nella sezione giusta…</span>}
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
              <Button type="button" variant="ghost" className="rounded-full" onClick={() => onOpenChange(false)}>
                Salta
              </Button>
              <Button
                type="button"
                variant="outline"
                className="rounded-full"
                onClick={() => setStepIndex((index) => Math.max(0, index - 1))}
                disabled={stepIndex === 0}
              >
                <ChevronLeft className="mr-2 h-4 w-4" />
                Indietro
              </Button>
              <Button
                type="button"
                className="rounded-full"
                onClick={() => {
                  if (isLastStep) {
                    onOpenChange(false);
                    return;
                  }
                  setStepIndex((index) => Math.min(steps.length - 1, index + 1));
                }}
              >
                {isLastStep ? "Chiudi tutorial" : "Continua"}
                {!isLastStep && <ChevronRight className="ml-2 h-4 w-4" />}
              </Button>
            </div>
          </div>
        </div>
      </div>

      <button
        type="button"
        className="sr-only"
        onClick={() => onOpenChange(false)}
        aria-label="Chiudi tutorial"
      >
        Chiudi tutorial
      </button>
    </div>
  );
}
