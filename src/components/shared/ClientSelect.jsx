import React from "react";
import { Check, ChevronsUpDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

function sortClientsByName(clients = []) {
  return [...clients].sort((a, b) =>
    String(a?.name || "").localeCompare(String(b?.name || ""), "it", {
      sensitivity: "base",
    })
  );
}

export default function ClientSelect({
  clients = [],
  value = "",
  onValueChange,
  placeholder = "Seleziona cliente",
  searchPlaceholder = "Cerca cliente...",
  emptyMessage = "Nessun cliente trovato.",
  allValue,
  allLabel = "Tutti i clienti",
  triggerClassName = "",
  contentClassName = "",
  disabled = false,
}) {
  const [open, setOpen] = React.useState(false);
  const sortedClients = React.useMemo(() => sortClientsByName(clients), [clients]);
  const selectedClient = sortedClients.find((client) => client.id === value);
  const selectedLabel =
    allValue && value === allValue
      ? allLabel
      : selectedClient?.name || "";

  const selectValue = (nextValue) => {
    onValueChange?.(nextValue);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            "h-10 w-full justify-between rounded-xl border-input/85 bg-background/85 px-3.5 py-2 text-left text-sm font-normal shadow-[inset_0_1px_0_rgb(255_255_255_/_0.4)] hover:bg-background/85",
            !selectedLabel && "text-muted-foreground/90",
            triggerClassName
          )}
        >
          <span className="truncate">{selectedLabel || placeholder}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className={cn("w-[var(--radix-popover-trigger-width)] p-0", contentClassName)}
      >
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyMessage}</CommandEmpty>
            <CommandGroup>
              {allValue ? (
                <CommandItem
                  value={allLabel}
                  onSelect={() => selectValue(allValue)}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      value === allValue ? "opacity-100" : "opacity-0"
                    )}
                  />
                  {allLabel}
                </CommandItem>
              ) : null}
              {sortedClients.map((client) => (
                <CommandItem
                  key={client.id}
                  value={`${client.name || ""} ${client.id || ""}`.trim()}
                  onSelect={() => selectValue(client.id)}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      value === client.id ? "opacity-100" : "opacity-0"
                    )}
                  />
                  {client.name || client.id}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export { sortClientsByName };
