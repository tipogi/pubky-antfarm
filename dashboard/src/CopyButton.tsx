import { useState } from "react";

export function CopyButton({ value, label }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard?.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // Clipboard unavailable (e.g. non-secure context); ignore.
    }
  };

  return (
    <button className="copy-btn" onClick={copy} title="Copy to clipboard">
      {copied ? "Copied" : (label ?? "Copy")}
    </button>
  );
}
