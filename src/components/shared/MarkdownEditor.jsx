import React, { useRef, useState } from "react";
import { Bold, Eye, Heading2, Italic, Link, List, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import MarkdownContent from "./MarkdownContent";

const FORMAT_CONFIG = {
  bold: { prefix: "**", suffix: "**", fallback: "testo" },
  italic: { prefix: "*", suffix: "*", fallback: "testo" },
  heading: { prefix: "## ", suffix: "", fallback: "Titolo sezione" },
  link: { prefix: "[", suffix: "](https://)", fallback: "link utile" },
};

export default function MarkdownEditor({
  value = "",
  onChange,
  placeholder = "",
  className,
  textareaClassName,
  previewClassName,
  minHeightClass = "min-h-[144px]",
  label = "contenuto",
  disabled = false,
}) {
  const textareaRef = useRef(null);
  const [showPreview, setShowPreview] = useState(false);

  const updateValue = (nextValue) => {
    onChange?.(nextValue);
  };

  const insertFormatting = (format) => {
    const textarea = textareaRef.current;
    const currentValue = String(value || "");
    const start = textarea?.selectionStart ?? currentValue.length;
    const end = textarea?.selectionEnd ?? currentValue.length;
    const selectedText = currentValue.slice(start, end);

    let nextChunk = "";
    let nextSelectionStart = start;
    let nextSelectionEnd = start;

    if (format === "list") {
      nextChunk = selectedText
        ? selectedText
            .split("\n")
            .map((line) => (line.trim() ? `- ${line}` : line))
            .join("\n")
        : "- ";
      nextSelectionEnd = start + nextChunk.length;
    } else {
      const config = FORMAT_CONFIG[format];
      if (!config) return;
      const content = selectedText || config.fallback;
      nextChunk = `${config.prefix}${content}${config.suffix}`;
      nextSelectionStart = start + config.prefix.length;
      nextSelectionEnd = nextSelectionStart + content.length;
    }

    updateValue(`${currentValue.slice(0, start)}${nextChunk}${currentValue.slice(end)}`);

    requestAnimationFrame(() => {
      if (!textarea) return;
      textarea.focus();
      textarea.setSelectionRange(nextSelectionStart, nextSelectionEnd);
    });
  };

  const toolbarButtonClass = "h-8 rounded-lg px-2.5 text-xs";

  return (
    <div className={cn("overflow-hidden rounded-xl border border-input/85 bg-background/85", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 bg-muted/25 px-2 py-2">
        <div className="flex flex-wrap items-center gap-1">
          <Button type="button" variant="ghost" size="sm" className={toolbarButtonClass} onClick={() => insertFormatting("bold")} disabled={disabled || showPreview} aria-label={`Grassetto in ${label}`}>
            <Bold className="h-3.5 w-3.5" />
          </Button>
          <Button type="button" variant="ghost" size="sm" className={toolbarButtonClass} onClick={() => insertFormatting("italic")} disabled={disabled || showPreview} aria-label={`Corsivo in ${label}`}>
            <Italic className="h-3.5 w-3.5" />
          </Button>
          <Button type="button" variant="ghost" size="sm" className={toolbarButtonClass} onClick={() => insertFormatting("heading")} disabled={disabled || showPreview} aria-label={`Titolo in ${label}`}>
            <Heading2 className="h-3.5 w-3.5" />
          </Button>
          <Button type="button" variant="ghost" size="sm" className={toolbarButtonClass} onClick={() => insertFormatting("list")} disabled={disabled || showPreview} aria-label={`Elenco in ${label}`}>
            <List className="h-3.5 w-3.5" />
          </Button>
          <Button type="button" variant="ghost" size="sm" className={toolbarButtonClass} onClick={() => insertFormatting("link")} disabled={disabled || showPreview} aria-label={`Link in ${label}`}>
            <Link className="h-3.5 w-3.5" />
          </Button>
          <span className="ml-1 text-[11px] text-muted-foreground">Markdown</span>
        </div>

        <Button
          type="button"
          variant={showPreview ? "secondary" : "ghost"}
          size="sm"
          className="h-8 rounded-lg px-2.5 text-xs"
          onClick={() => setShowPreview((current) => !current)}
          aria-pressed={showPreview}
        >
          {showPreview ? <Pencil className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          {showPreview ? "Modifica" : "Anteprima"}
        </Button>
      </div>

      {showPreview ? (
        <div className={cn("p-4", minHeightClass, previewClassName)}>
          <MarkdownContent emptyText="Nessun contenuto da mostrare.">{value}</MarkdownContent>
        </div>
      ) : (
        <Textarea
          ref={textareaRef}
          value={value}
          onChange={(event) => updateValue(event.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          aria-label={label}
          className={cn(
            "resize-y rounded-none border-0 bg-transparent shadow-none focus-visible:border-transparent focus-visible:ring-0",
            minHeightClass,
            textareaClassName,
          )}
        />
      )}
    </div>
  );
}
