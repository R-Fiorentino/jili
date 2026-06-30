import React from "react";
import ReactMarkdown from "react-markdown";
import { cn } from "@/lib/utils";

export function normalizeMarkdownLinks(text = "") {
  return String(text || "")
    .split(/(\s+)/)
    .map((token) => {
      if (!/^https?:\/\/\S+$/i.test(token)) return token;

      const match = token.match(/^(https?:\/\/[^\s<]+?)([.,!?;:)]*)$/i);
      if (!match) return token;

      const [, url, trailing = ""] = match;
      return `<${url}>${trailing}`;
    })
    .join("");
}

export default function MarkdownContent({
  children,
  className,
  emptyText = "",
  allowMentions = false,
}) {
  const value = String(children || "").trim();

  if (!value) {
    return emptyText ? <p className={cn("text-sm text-muted-foreground", className)}>{emptyText}</p> : null;
  }

  return (
    <div className={cn("min-w-0 text-sm leading-6 text-foreground/85", className)}>
      <ReactMarkdown
        components={{
          h1: ({ children: content }) => (
            <h1 className="mb-3 mt-5 text-xl font-semibold text-foreground first:mt-0">{content}</h1>
          ),
          h2: ({ children: content }) => (
            <h2 className="mb-2 mt-5 text-lg font-semibold text-foreground first:mt-0">{content}</h2>
          ),
          h3: ({ children: content }) => (
            <h3 className="mb-2 mt-4 text-base font-semibold text-foreground first:mt-0">{content}</h3>
          ),
          p: ({ children: content }) => (
            <p className="leading-7 [&:not(:first-child)]:mt-3">{content}</p>
          ),
          strong: ({ children: content }) => (
            <strong className="font-semibold text-foreground">{content}</strong>
          ),
          em: ({ children: content }) => <em className="italic text-foreground/90">{content}</em>,
          a: ({ href, children: content }) =>
            allowMentions && String(href || "").startsWith("mention:") ? (
              <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                {content}
              </span>
            ) : (
              <a
                href={href}
                target="_blank"
                rel="noreferrer"
                className="break-words font-medium text-primary underline decoration-primary/35 underline-offset-4"
              >
                {content}
              </a>
            ),
          ul: ({ children: content }) => (
            <ul className="ml-5 mt-3 list-disc space-y-1.5 marker:text-muted-foreground">{content}</ul>
          ),
          ol: ({ children: content }) => (
            <ol className="ml-5 mt-3 list-decimal space-y-1.5 marker:text-muted-foreground">{content}</ol>
          ),
          li: ({ children: content }) => <li className="pl-1">{content}</li>,
          blockquote: ({ children: content }) => (
            <blockquote className="my-3 border-l-2 border-primary/35 pl-4 text-foreground/70">{content}</blockquote>
          ),
          code: ({ children: content }) => (
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.9em] text-foreground">{content}</code>
          ),
          pre: ({ children: content }) => (
            <pre className="my-3 overflow-x-auto rounded-xl bg-muted p-4 text-xs leading-5 text-foreground">{content}</pre>
          ),
          hr: () => <hr className="my-5 border-border/70" />,
        }}
      >
        {normalizeMarkdownLinks(value)}
      </ReactMarkdown>
    </div>
  );
}
