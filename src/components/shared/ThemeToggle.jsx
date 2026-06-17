import React from "react";
import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";

const THEME_OPTIONS = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
];

export default function ThemeToggle({ className = "", compact = false }) {
  const { theme = "system", resolvedTheme, setTheme } = useTheme();
  const activeTheme = theme === "system"
    ? (resolvedTheme === "dark" ? "dark" : "light")
    : theme;
  const nextTheme = activeTheme === "dark" ? "light" : "dark";
  const ActiveIcon = activeTheme === "dark" ? Moon : Sun;

  if (compact) {
    return (
      <button
        type="button"
        onClick={() => setTheme(nextTheme)}
        className={cn(
          "inline-flex h-9 w-full items-center justify-center rounded-xl border border-border/70 bg-muted/70 text-muted-foreground transition-[background-color,color,border-color,box-shadow,transform] duration-150 hover:border-border/90 hover:bg-card hover:text-foreground active:scale-[0.98]",
          className
        )}
        title={`Passa a ${nextTheme === "dark" ? "Dark" : "Light"}`}
      >
        <ActiveIcon className="w-4 h-4" />
      </button>
    );
  }

  return (
    <div
      className={cn(
        "flex h-10 w-full items-center rounded-xl border border-border/70 bg-muted/70 p-1 shadow-[var(--shadow-soft)]",
        className
      )}
      role="group"
      aria-label="Selezione tema"
    >
      {THEME_OPTIONS.map((option) => {
        const Icon = option.icon;
        const isActive = activeTheme === option.value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => setTheme(option.value)}
            className={cn(
              "inline-flex h-full flex-1 items-center justify-center gap-1.5 rounded-lg text-xs font-semibold transition-[background-color,color,box-shadow,transform] duration-150 active:scale-[0.98]",
              isActive
                ? "bg-card text-foreground shadow-[var(--shadow-soft)]"
                : "text-muted-foreground hover:text-foreground"
            )}
            aria-pressed={isActive}
            title={`Attiva tema ${option.label}`}
          >
            <Icon className="w-3.5 h-3.5" />
            {option.label}
          </button>
        );
      })}
      {theme === "system" && (
        <span className="sr-only">
          Tema automatico di sistema attivo ({resolvedTheme === "dark" ? "Dark" : "Light"})
        </span>
      )}
    </div>
  );
}
