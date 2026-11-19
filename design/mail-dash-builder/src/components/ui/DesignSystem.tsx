import React, { useState } from 'react';
import {
  AlertCircleIcon,
  ArrowRightIcon,
  CheckMarkIcon,
  PauseGlyphIcon,
  XMarkIcon,
} from './BrandIcons';

/* ─── Portfolio Pill CTA Button (Signature rounded-[70px] with inset arrow circle) ─── */
interface PortfolioPillButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'subtle';
  size?: 'lg' | 'md' | 'sm';
  children: React.ReactNode;
  hideArrow?: boolean;
}

export const PortfolioPillButton: React.FC<PortfolioPillButtonProps> = ({
  variant = 'primary',
  size = 'lg',
  children,
  hideArrow = false,
  className = '',
  disabled,
  ...props
}) => {
  const sizeClasses =
    size === 'lg'
      ? 'h-[52px] pl-5 pr-2.5 text-[13px] gap-4'
      : size === 'md'
        ? 'h-[44px] pl-5 pr-2.5 text-[13px] gap-3.5'
        : 'h-[36px] pl-4 pr-2 text-[12px] gap-2.5';

  const insetSize =
    size === 'lg' ? 'w-8 h-8' : size === 'md' ? 'w-6 h-6' : 'w-5 h-5';

  const arrowSize = size === 'sm' ? 14 : 18;

  const variantClasses =
    variant === 'primary'
      ? 'bg-[var(--color-brand)] text-[var(--color-onBrand)] hover:opacity-95'
      : variant === 'secondary'
        ? 'bg-[var(--color-surface)] text-[var(--color-brand)] border border-[var(--color-border)] hover:bg-[var(--color-subtle)]'
        : 'bg-[var(--color-subtle)] text-[var(--color-text)] border border-[var(--color-border)] hover:bg-[var(--color-tint)]';

  const insetBg =
    variant === 'primary'
      ? 'bg-white text-[var(--color-brand)]'
      : variant === 'secondary'
        ? 'bg-[var(--color-tint)] text-[var(--color-brand)]'
        : 'bg-[var(--color-surface)] text-[var(--color-text)]';

  return (
    <button
      type="button"
      disabled={disabled}
      className={`group inline-flex items-center justify-between rounded-[70px] font-medium whitespace-nowrap shrink-0 transition-all duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-canvas)] disabled:opacity-50 disabled:cursor-not-allowed ${sizeClasses} ${variantClasses} ${className}`}
      {...props}
    >
      <span>{children}</span>
      {!hideArrow && (
        <span
          className={`inline-flex items-center justify-center rounded-full shrink-0 transition-transform duration-150 group-hover:translate-x-0.5 ${insetSize} ${insetBg}`}
        >
          <ArrowRightIcon size={arrowSize} />
        </span>
      )}
    </button>
  );
};

/* ─── Metric Card (rounded-[16px], 1px border, 38px tint icon tile, 34px tabular figure) ─── */
interface MetricCardProps {
  label: string;
  value: string | number;
  subtitle: string;
  icon: React.ReactNode;
  onClick?: () => void;
  active?: boolean;
}

export const MetricCard: React.FC<MetricCardProps> = ({
  label,
  value,
  subtitle,
  icon,
  onClick,
  active = false,
}) => {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={`w-full text-left rounded-[16px] border bg-[var(--color-surface)] px-[22px] py-[18px] transition-colors duration-150 ${
        active
          ? 'border-[var(--color-brand)] ring-1 ring-[var(--color-brand)]'
          : 'border-[var(--color-border)]'
      } ${onClick ? 'cursor-pointer hover:border-[var(--color-brand)]/60' : ''}`}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="text-[11px] font-medium uppercase tracking-[0.04em] text-[var(--color-muted)] pt-0.5">
          {label}
        </span>
        <span className="w-[38px] h-[38px] rounded-[10px] bg-[var(--color-tint)] text-[var(--color-brand)] inline-flex items-center justify-center shrink-0">
          {icon}
        </span>
      </div>
      <div className="mt-1 text-[34px] font-semibold leading-[1.3] text-[var(--color-text)] tabular-nums tracking-[-0.02em]">
        {value}
      </div>
      <div className="mt-0.5 text-[12px] text-[var(--color-muted)] truncate">
        {subtitle}
      </div>
    </Tag>
  );
};

/* ─── Notice Banner (rounded-[14px], --color-tint background) ─── */
interface NoticeBannerProps {
  title: string;
  subtitle: string;
  actionLabel?: string;
  onAction?: () => void;
  tone?: 'brand' | 'warning' | 'success';
}

export const NoticeBanner: React.FC<NoticeBannerProps> = ({
  title,
  subtitle,
  actionLabel,
  onAction,
  tone = 'brand',
}) => {
  const bgClass =
    tone === 'warning'
      ? 'bg-[var(--color-warningTint)]'
      : tone === 'success'
        ? 'bg-[var(--color-successTint)]'
        : 'bg-[var(--color-tint)]';

  const iconColor =
    tone === 'warning'
      ? 'text-[var(--color-warning)]'
      : tone === 'success'
        ? 'text-[var(--color-success)]'
        : 'text-[var(--color-brand)]';

  return (
    <div
      className={`w-full rounded-[14px] ${bgClass} px-5 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4`}
    >
      <div className="flex items-start sm:items-center gap-4 min-w-0">
        <span className={`shrink-0 ${iconColor}`}>
          <AlertCircleIcon size={26} />
        </span>
        <div className="min-w-0">
          <p className="text-[14px] font-semibold text-[var(--color-text)] leading-[1.4]">
            {title}
          </p>
          <p className="text-[12px] text-[var(--color-muted)] leading-[1.4] mt-0.5">
            {subtitle}
          </p>
        </div>
      </div>
      {actionLabel && onAction && (
        <div className="shrink-0">
          <PortfolioPillButton
            variant="secondary"
            size="md"
            onClick={onAction}
            className="h-[46px]"
          >
            {actionLabel}
          </PortfolioPillButton>
        </div>
      )}
    </div>
  );
};

/* ─── Status Badge (Semantic capsule matching Figma table & header states) ─── */
export type StatusTone = 'success' | 'warning' | 'danger' | 'brand' | 'neutral';

interface StatusBadgeProps {
  label: string;
  tone: StatusTone;
  icon?: 'check' | 'x' | 'alert' | 'pause' | 'none';
  size?: 'sm' | 'md';
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({
  label,
  tone,
  icon = 'none',
  size = 'sm',
}) => {
  const toneStyles: Record<StatusTone, string> = {
    success: 'bg-[var(--color-successTint)] text-[var(--color-success)]',
    warning: 'bg-[var(--color-warningTint)] text-[var(--color-warning)]',
    danger: 'bg-[var(--color-dangerTint)] text-[var(--color-danger)]',
    brand: 'bg-[var(--color-tint)] text-[var(--color-brand)]',
    neutral: 'bg-[var(--color-subtle)] text-[var(--color-muted)]',
  };

  const renderIcon = () => {
    if (icon === 'check') return <CheckMarkIcon size={12} />;
    if (icon === 'x') return <XMarkIcon size={12} />;
    if (icon === 'alert') return <AlertCircleIcon size={12} />;
    if (icon === 'pause') return <PauseGlyphIcon size={13} />;
    return null;
  };

  return (
    <span
      className={`inline-flex items-center justify-center gap-1.5 rounded-full font-medium whitespace-nowrap shrink-0 ${
        size === 'md'
          ? 'h-[30px] px-3.5 text-[10px] font-semibold uppercase tracking-[0.04em]'
          : 'h-[24px] px-2.5 text-[10px] font-medium min-w-[110px]'
      } ${toneStyles[tone]}`}
    >
      {renderIcon()}
      <span>{label}</span>
    </span>
  );
};

/* ─── Surface Panel (rounded-[18px], 1px border, --color-surface) ─── */
interface SurfacePanelProps {
  children: React.ReactNode;
  className?: string;
}

export const SurfacePanel: React.FC<SurfacePanelProps> = ({
  children,
  className = '',
}) => (
  <section
    className={`rounded-[18px] border border-[var(--color-border)] bg-[var(--color-surface)] ${className}`}
  >
    {children}
  </section>
);

/* ─── Avatar with graceful initials fallback ─── */
interface AvatarProps {
  src?: string;
  name: string;
  size?: number;
  className?: string;
}

export const Avatar: React.FC<AvatarProps> = ({
  src,
  name,
  size = 40,
  className = '',
}) => {
  const [failed, setFailed] = useState(false);
  const initials = name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');

  if (!src || failed) {
    return (
      <span
        style={{ width: size, height: size }}
        className={`inline-flex items-center justify-center rounded-full bg-[var(--color-tint)] text-[var(--color-brand)] text-[12px] font-semibold shrink-0 border-2 border-[var(--color-surface)] ${className}`}
        aria-label={name}
      >
        {initials || 'MD'}
      </span>
    );
  }

  return (
    <img
      src={src}
      alt={name}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      style={{ width: size, height: size }}
      className={`rounded-full object-cover shrink-0 border-2 border-[var(--color-surface)] ${className}`}
    />
  );
};

/* ─── Modal Shell ─── */
interface ModalShellProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  maxWidth?: string;
}

export const ModalShell: React.FC<ModalShellProps> = ({
  open,
  onClose,
  title,
  subtitle,
  children,
  maxWidth = 'max-w-[540px]',
}) => {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/45 backdrop-blur-[2px]"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className={`w-full ${maxWidth} rounded-[18px] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-xl overflow-hidden`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-5 border-b border-[var(--color-border)] flex items-start justify-between gap-4">
          <div>
            <h2 className="text-[18px] font-semibold text-[var(--color-text)] leading-[1.35]">
              {title}
            </h2>
            {subtitle && (
              <p className="text-[12px] text-[var(--color-muted)] mt-0.5">
                {subtitle}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-[var(--color-subtle)] text-[var(--color-muted)] hover:text-[var(--color-text)] inline-flex items-center justify-center transition-colors cursor-pointer"
            aria-label="Close modal"
          >
            <XMarkIcon size={16} />
          </button>
        </div>
        <div className="p-6 max-h-[80vh] overflow-y-auto">{children}</div>
      </div>
    </div>
  );
};
