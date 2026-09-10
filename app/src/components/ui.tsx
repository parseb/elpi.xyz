import { useEffect, useRef, useState, type ReactNode } from "react";
import { CheckIcon, CloseIcon, CopyIcon, InfoIcon, WalletIcon } from "@/components/icons";
import { parseFriendlyError } from "@/lib/errorFormat";

export function Tooltip({
  content,
  children,
  placement = "top",
  className = "",
  maxWidth = "max-w-xs",
}: {
  content: ReactNode;
  children: ReactNode;
  placement?: "top" | "bottom" | "left" | "right";
  className?: string;
  maxWidth?: string;
}) {
  const [visible, setVisible] = useState(false);
  const triggerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!visible) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setVisible(false);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [visible]);

  const placementClasses = {
    top: "bottom-full left-1/2 -translate-x-1/2 mb-2",
    bottom: "top-full left-1/2 -translate-x-1/2 mt-2",
    left: "right-full top-1/2 -translate-y-1/2 mr-2",
    right: "left-full top-1/2 -translate-y-1/2 ml-2",
  }[placement];

  const arrowClasses = {
    top: "top-full left-1/2 -translate-x-1/2 border-t-[var(--surface-overlay)] border-x-transparent border-b-transparent border-[5px]",
    bottom: "bottom-full left-1/2 -translate-x-1/2 border-b-[var(--surface-overlay)] border-x-transparent border-t-transparent border-[5px]",
    left: "left-full top-1/2 -translate-y-1/2 border-l-[var(--surface-overlay)] border-y-transparent border-r-transparent border-[5px]",
    right: "right-full top-1/2 -translate-y-1/2 border-r-[var(--surface-overlay)] border-y-transparent border-l-transparent border-[5px]",
  }[placement];

  if (!content) return <>{children}</>;

  return (
    <div
      ref={triggerRef}
      className={`relative inline-flex items-center ${className}`}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onFocus={() => setVisible(true)}
      onBlur={() => setVisible(false)}
    >
      {children}
      {visible && (
        <div
          role="tooltip"
          className={`pointer-events-none absolute z-50 ${placementClasses} ${maxWidth} rounded-lg border border-[var(--border-strong)] bg-[var(--surface-overlay)] px-2.5 py-1.5 text-xs text-[var(--foreground)] shadow-xl animate-in fade-in zoom-in-95 duration-100 backdrop-blur-md`}
        >
          <div className="font-normal leading-relaxed">{content}</div>
          <div className={`absolute h-0 w-0 pointer-events-none ${arrowClasses}`} />
        </div>
      )}
    </div>
  );
}

export function InfoTooltip({
  content,
  size = 13,
  className = "",
}: {
  content: ReactNode;
  size?: number;
  className?: string;
}) {
  return (
    <Tooltip content={content}>
      <button
        type="button"
        aria-label="More information"
        className={`inline-flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--base-blue-light)] transition-colors cursor-help p-0.5 rounded focus-visible:ring-2 focus-visible:ring-[var(--base-blue)] ${className}`}
      >
        <InfoIcon size={size} />
      </button>
    </Tooltip>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  tooltip,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  tooltip?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight text-[var(--foreground)] sm:text-3xl">{title}</h1>
          {tooltip && <InfoTooltip content={tooltip} size={16} />}
        </div>
        {description && (
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-[var(--text-muted)]">{description}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2.5">{actions}</div>}
    </header>
  );
}

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] p-5 sm:p-6 shadow-xs transition-shadow hover:shadow-md ${className}`}
    >
      {children}
    </div>
  );
}

export function Section({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-xl border border-[var(--card-border)] bg-[var(--card-bg)] ${className}`}>
      {children}
    </section>
  );
}

const STAT_ACCENTS = {
  neutral: "text-[var(--foreground)]",
  blue: "text-[var(--base-blue-light)]",
  emerald: "text-[var(--emerald-text)]",
  amber: "text-[var(--amber-text)]",
  red: "text-[var(--red-text)]",
  cyan: "text-[var(--base-blue-light)]",
} as const;

export function StatTile({
  label,
  value,
  sub,
  accent = "neutral",
  tooltip,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  accent?: keyof typeof STAT_ACCENTS;
  tooltip?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-[var(--card-border)] bg-[var(--surface-raised)] p-4 sm:p-5">
      <div className="flex items-center justify-between gap-1">
        <div className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">{label}</div>
        {tooltip && <InfoTooltip content={tooltip} size={12} />}
      </div>
      <div className={`mt-1.5 font-mono text-2xl font-bold tabular-nums tracking-tight ${STAT_ACCENTS[accent]}`}>
        {value}
      </div>
      {sub && <div className="mt-1 text-xs text-[var(--text-muted)]">{sub}</div>}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  action,
  children,
}: {
  icon?: ReactNode;
  title?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      role="region"
      aria-label={title || "Empty State"}
      className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-[var(--border-hover)] bg-[var(--surface-raised)] px-6 py-14 text-center"
    >
      {icon && <div className="text-[var(--text-muted)]">{icon}</div>}
      {title && <h2 className="text-base font-semibold text-[var(--foreground)]">{title}</h2>}
      <p className="max-w-sm text-sm text-[var(--text-muted)]">{children}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

EmptyState.WalletIcon = WalletIcon;

export function ErrorBanner({
  message,
  onRetry,
  className = "",
}: {
  message: string | Error | null | undefined;
  onRetry?: () => void;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  if (!message) return null;

  const { short, full, isRejection } = parseFriendlyError(message);

  if (isRejection) {
    return (
      <div
        className={`flex items-center justify-between gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3 py-2 text-xs text-[var(--text-muted)] ${className}`}
      >
        <span className="italic">{short}</span>
        <button
          type="button"
          onClick={() => {
            navigator.clipboard.writeText(full);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
          className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--text-muted)] hover:text-[var(--foreground)] transition-colors cursor-pointer"
          title="Copy details"
        >
          {copied ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
          <span>{copied ? "Copied" : "Copy"}</span>
        </button>
      </div>
    );
  }

  return (
    <div
      role="alert"
      aria-live="assertive"
      className={`flex items-start justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-raised)] p-3 text-xs text-[var(--foreground)] shadow-xs ${className}`}
    >
      <div className="flex items-start gap-2 min-w-0 flex-1">
        <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--red-text)]" />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-[var(--foreground)] break-words leading-relaxed">{short}</p>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={() => {
            navigator.clipboard.writeText(full);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
          className="inline-flex min-h-[28px] items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-xs font-semibold text-[var(--text-muted)] hover:bg-[var(--surface-overlay)] hover:text-[var(--foreground)] transition-colors cursor-pointer"
          title="Copy full error details"
        >
          {copied ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
          <span>{copied ? "Copied" : "Copy"}</span>
        </button>

        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex min-h-[28px] items-center rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-xs font-semibold text-[var(--foreground)] hover:bg-[var(--surface-overlay)] transition-colors cursor-pointer"
          >
            Retry
          </button>
        )}
      </div>
    </div>
  );
}

export function Badge({
  children,
  tone = "neutral",
  tooltip,
}: {
  children: ReactNode;
  tone?: "neutral" | "blue" | "cyan" | "amber" | "emerald" | "purple";
  tooltip?: ReactNode;
}) {
  const tones = {
    neutral: "bg-[var(--surface-raised)] text-[var(--foreground)] border border-[var(--border)]",
    blue: "bg-[var(--base-blue-faint)] text-[var(--base-blue-light)] border border-[var(--base-blue-muted)]",
    cyan: "bg-[var(--base-blue-faint)] text-[var(--base-blue-light)] border border-[var(--base-blue-muted)]",
    amber: "bg-[var(--amber-bg)] text-[var(--amber-text)] border border-[var(--amber-border)]",
    emerald: "bg-[var(--emerald-bg)] text-[var(--emerald-text)] border border-[var(--emerald-border)]",
    purple: "bg-[rgba(168,85,247,0.12)] text-[#c084fc] border border-[rgba(168,85,247,0.3)]",
  } as const;

  const badgeEl = (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${tones[tone]}`}>
      {children}
    </span>
  );

  if (tooltip) {
    return <Tooltip content={tooltip}>{badgeEl}</Tooltip>;
  }

  return badgeEl;
}

export const inputClass =
  "w-full rounded-lg border border-[var(--border)] bg-[var(--surface-raised)] px-3.5 py-2.5 text-sm text-[var(--foreground)] placeholder:text-[var(--text-muted)] focus:border-[var(--base-blue)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--base-blue)]/30 transition-all";

export function Field({
  label,
  tooltip,
  children,
}: {
  label: string;
  tooltip?: ReactNode;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <div className="flex items-center justify-between">
        <span className="font-medium text-[var(--text-muted)]">{label}</span>
        {tooltip && <InfoTooltip content={tooltip} size={12} />}
      </div>
      {children}
    </label>
  );
}

const BUTTON_VARIANTS = {
  primary:
    "bg-[var(--base-blue)] text-white hover:bg-[var(--base-blue-hover)] active:bg-[var(--action-primary-active)] shadow-sm disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-[var(--base-blue)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)]",
  accent:
    "bg-[var(--base-blue)] text-white hover:bg-[var(--base-blue-hover)] active:bg-[var(--action-primary-active)] shadow-sm disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-[var(--base-blue)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)]",
  secondary:
    "border border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)] hover:bg-[var(--surface-raised)] active:bg-[var(--surface-overlay)] disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-[var(--base-blue)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)]",
  ghost:
    "text-[var(--text-muted)] hover:bg-[var(--surface-raised)] hover:text-[var(--foreground)] active:bg-[var(--surface-overlay)] disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-[var(--base-blue)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)]",
  destructive:
    "bg-[var(--action-destructive)] text-white hover:bg-[var(--action-destructive-hover)] active:bg-[var(--action-destructive-hover)] shadow-sm disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-[var(--action-destructive)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)]",
} as const;

export function Button({
  children,
  variant = "secondary",
  className = "",
  type = "button",
  tooltip,
  ...rest
}: {
  children: ReactNode;
  variant?: keyof typeof BUTTON_VARIANTS;
  className?: string;
  tooltip?: ReactNode;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const btn = (
    <button
      type={type}
      className={`inline-flex min-h-[40px] items-center justify-center rounded-lg px-4 py-2.5 text-sm font-semibold transition-all focus:outline-none cursor-pointer disabled:cursor-not-allowed ${BUTTON_VARIANTS[variant]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );

  if (tooltip) {
    return <Tooltip content={tooltip}>{btn}</Tooltip>;
  }

  return btn;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmText = "Confirm",
  cancelText = "Cancel",
  variant = "destructive",
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmText?: string;
  cancelText?: string;
  variant?: "primary" | "destructive";
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-150"
    >
      <div className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--card-bg)] p-6 shadow-2xl animate-in zoom-in-95 duration-150">
        <div className="flex items-start justify-between gap-4">
          <h3 id="confirm-dialog-title" className="text-base font-bold text-[var(--foreground)]">
            {title}
          </h3>
          <button
            type="button"
            onClick={onCancel}
            className="text-[var(--text-muted)] hover:text-[var(--foreground)] cursor-pointer"
            aria-label="Close dialog"
          >
            <CloseIcon size={18} />
          </button>
        </div>
        <div className="mt-2 text-xs leading-relaxed text-[var(--text-muted)]">{description}</div>
        <div className="mt-6 flex items-center justify-end gap-2.5">
          <Button variant="secondary" onClick={onCancel} className="text-xs min-h-[36px]">
            {cancelText}
          </Button>
          <Button
            variant={variant === "destructive" ? "destructive" : "primary"}
            onClick={onConfirm}
            className="text-xs min-h-[36px]"
          >
            {confirmText}
          </Button>
        </div>
      </div>
    </div>
  );
}

export const label = "text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]";
export const dimText = "text-xs text-[var(--text-muted)]";
export const mono = "font-mono tabular-nums";
