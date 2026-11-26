import React from 'react';

interface IconProps {
  className?: string;
  size?: number;
  strokeWidth?: number;
}

export const MyMailMark: React.FC<{ size?: number }> = ({ size = 40 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 40 40"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className="shrink-0"
    aria-hidden="true"
  >
    <rect width="40" height="40" rx="9" fill="var(--color-brand)" />
    <path d="M8 11L20 20L32 11V29H27V21L20 26.25L13 21V29H8V11Z" fill="white" />
  </svg>
);

export const DashboardIcon: React.FC<IconProps> = ({ size = 21, className }) => (
  <svg width={size} height={size} viewBox="0 0 21 21" fill="none" className={className} aria-hidden="true">
    <path
      d="M3.9375 2.625H7.4375C8.16237 2.625 8.75 3.21263 8.75 3.9375V7.4375C8.75 8.16237 8.16237 8.75 7.4375 8.75H3.9375C3.21263 8.75 2.625 8.16237 2.625 7.4375V3.9375C2.625 3.21263 3.21263 2.625 3.9375 2.625Z"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M13.5625 2.625H17.0625C17.7874 2.625 18.375 3.21263 18.375 3.9375V7.4375C18.375 8.16237 17.7874 8.75 17.0625 8.75H13.5625C12.8376 8.75 12.25 8.16237 12.25 7.4375V3.9375C12.25 3.21263 12.8376 2.625 13.5625 2.625Z"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M3.9375 12.25H7.4375C8.16237 12.25 8.75 12.8376 8.75 13.5625V17.0625C8.75 17.7874 8.16237 18.375 7.4375 18.375H3.9375C3.21263 18.375 2.625 17.7874 2.625 17.0625V13.5625C2.625 12.8376 3.21263 12.25 3.9375 12.25Z"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M13.5625 12.25H17.0625C17.7874 12.25 18.375 12.8376 18.375 13.5625V17.0625C18.375 17.7874 17.7874 18.375 17.0625 18.375H13.5625C12.8376 18.375 12.25 17.7874 12.25 17.0625V13.5625C12.25 12.8376 12.8376 12.25 13.5625 12.25Z"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const InboxIcon: React.FC<IconProps> = ({ size = 21, className }) => (
  <svg width={size} height={size} viewBox="0 0 21 21" fill="none" className={className} aria-hidden="true">
    <path
      d="M4.375 3.5H16.625C17.5915 3.5 18.375 4.2835 18.375 5.25V15.75C18.375 16.7165 17.5915 17.5 16.625 17.5H4.375C3.4085 17.5 2.625 16.7165 2.625 15.75V5.25C2.625 4.2835 3.4085 3.5 4.375 3.5Z"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M2.625 4.375L10.5 10.5L18.375 4.375"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const SendIcon: React.FC<IconProps> = ({ size = 21, className }) => (
  <svg width={size} height={size} viewBox="0 0 21 21" fill="none" className={className} aria-hidden="true">
    <path
      d="M19.25 1.75L13.125 19.25L9.625 11.375L1.75 7.875L19.25 1.75Z"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M19.25 1.75L9.625 11.375"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const UsersIcon: React.FC<IconProps> = ({ size = 21, className }) => (
  <svg width={size} height={size} viewBox="0 0 21 21" fill="none" className={className} aria-hidden="true">
    <path
      d="M14 18.375V16.625C14 15.6967 13.6313 14.8065 12.9749 14.1501C12.3185 13.4938 11.4283 13.125 10.5 13.125H5.25C4.32174 13.125 3.4315 13.4938 2.77513 14.1501C2.11875 14.8065 1.75 15.6967 1.75 16.625V18.375M19.25 18.375V16.625C19.2494 15.8495 18.9913 15.0962 18.5162 14.4833C18.0411 13.8704 17.3759 13.4326 16.625 13.2388M14 2.73875C14.7529 2.93152 15.4202 3.36937 15.8967 3.98328C16.3732 4.59718 16.6319 5.35223 16.6319 6.12938C16.6319 6.90653 16.3732 7.66157 15.8967 8.27548C15.4202 8.88939 14.7529 9.32724 14 9.52"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M11.375 6.125C11.375 8.058 9.808 9.625 7.875 9.625C5.942 9.625 4.375 8.058 4.375 6.125C4.375 4.192 5.942 2.625 7.875 2.625C9.808 2.625 11.375 4.192 11.375 6.125Z"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const CalendarIcon: React.FC<IconProps> = ({ size = 21, className }) => (
  <svg width={size} height={size} viewBox="0 0 21 21" fill="none" className={className} aria-hidden="true">
    <path
      d="M4.375 4.375H16.625C17.5915 4.375 18.375 5.1585 18.375 6.125V16.625C18.375 17.5915 17.5915 18.375 16.625 18.375H4.375C3.4085 18.375 2.625 17.5915 2.625 16.625V6.125C2.625 5.1585 3.4085 4.375 4.375 4.375Z"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M14 2.625V6.125M7 2.625V6.125M2.625 9.625H18.375M7.875 13.125H9.625"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const AccountIcon: React.FC<IconProps> = ({ size = 21, className }) => (
  <svg width={size} height={size} viewBox="0 0 21 21" fill="none" className={className} aria-hidden="true">
    <path
      d="M6.125 2.625H14.875C16.808 2.625 18.375 4.192 18.375 6.125V14.875C18.375 16.808 16.808 18.375 14.875 18.375H6.125C4.192 18.375 2.625 16.808 2.625 14.875V6.125C2.625 4.192 4.192 2.625 6.125 2.625Z"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M13.125 7.875C13.125 9.32475 11.9497 10.5 10.5 10.5C9.05025 10.5 7.875 9.32475 7.875 7.875C7.875 6.42525 9.05025 5.25 10.5 5.25C11.9497 5.25 13.125 6.42525 13.125 7.875Z"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M5.25 17.5V16.625C5.25 15.2326 5.80312 13.8973 6.78769 12.9127C7.77226 11.9281 9.10761 11.375 10.5 11.375C11.8924 11.375 13.2277 11.9281 14.2123 12.9127C15.1969 13.8973 15.75 15.2326 15.75 16.625V17.5"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const SettingsIcon: React.FC<IconProps> = ({ size = 21, className }) => (
  <svg width={size} height={size} viewBox="0 0 21 21" fill="none" className={className} aria-hidden="true">
    <path
      d="M7.87501 2.625L7.35001 4.6375L5.60001 5.425L3.76251 4.8125L2.01251 7.875L3.41251 9.3625V11.6375L2.01251 13.125L3.76251 16.1875L5.68751 15.575L7.43751 16.3625L7.87501 18.375H11.375L11.9 16.3625L13.65 15.575L15.4875 16.1875L17.2375 13.125L15.8375 11.6375V9.3625L17.2375 7.875L15.4875 4.8125L13.65 5.425L11.9 4.6375L11.375 2.625H7.87501Z"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M12.25 10.5C12.25 11.9497 11.0747 13.125 9.625 13.125C8.17525 13.125 7 11.9497 7 10.5C7 9.05025 8.17525 7.875 9.625 7.875C11.0747 7.875 12.25 9.05025 12.25 10.5Z"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const AlertCircleIcon: React.FC<IconProps> = ({ size = 20, className }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" className={className} aria-hidden="true">
    <path
      d="M17.5 10C17.5 14.1421 14.1421 17.5 10 17.5C5.85786 17.5 2.5 14.1421 2.5 10C2.5 5.85786 5.85786 2.5 10 2.5C14.1421 2.5 17.5 5.85786 17.5 10Z"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M10 6.66667V10.8333M10 13.3333H10.0083"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const ClockIcon: React.FC<IconProps> = ({ size = 20, className }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" className={className} aria-hidden="true">
    <path
      d="M17.5 10C17.5 14.1421 14.1421 17.5 10 17.5C5.85786 17.5 2.5 14.1421 2.5 10C2.5 5.85786 5.85786 2.5 10 2.5C14.1421 2.5 17.5 5.85786 17.5 10Z"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M10 5.83333V10L12.5 11.6667"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const XMarkIcon: React.FC<IconProps> = ({ size = 20, className }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" className={className} aria-hidden="true">
    <path
      d="M5 5L15 15M5 15L15 5"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const CheckMarkIcon: React.FC<IconProps> = ({ size = 12, className }) => (
  <svg width={size} height={size} viewBox="0 0 12 12" fill="none" className={className} aria-hidden="true">
    <path
      d="M2.5 6L4.5 8L9.5 3"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const PauseGlyphIcon: React.FC<IconProps> = ({ size = 14, className }) => (
  <svg width={size} height={size} viewBox="0 0 14 14" fill="none" className={className} aria-hidden="true">
    <path
      d="M5.25 2.91667V11.0833M8.75 2.91667V11.0833"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const ArrowRightIcon: React.FC<IconProps> = ({ size = 20, className }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" className={className} aria-hidden="true">
    <path
      d="M4.16669 10H15.8334M10.8334 15L15.8334 10L10.8334 5"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const SunIcon: React.FC<IconProps> = ({ size = 18, className }) => (
  <svg width={size} height={size} viewBox="0 0 18 18" fill="none" className={className} aria-hidden="true">
    <path
      d="M12 9C12 10.6569 10.6569 12 9 12C7.34315 12 6 10.6569 6 9C6 7.34315 7.34315 6 9 6C10.6569 6 12 7.34315 12 9Z"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M9 1.5V3M9 15V16.5M1.5 9H3M15 9H16.5M3.6975 3.6975L4.7625 4.7625M13.2375 13.2375L14.3025 14.3025M3.6975 14.3025L4.7625 13.2375M13.2375 4.7625L14.3025 3.6975"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const MoonIcon: React.FC<IconProps> = ({ size = 18, className }) => (
  <svg width={size} height={size} viewBox="0 0 18 18" fill="none" className={className} aria-hidden="true">
    <path
      d="M15.75 9.95A6.75 6.75 0 0 1 8.05 2.25a6.75 6.75 0 1 0 7.7 7.7Z"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const ChevronDownIcon: React.FC<IconProps> = ({ size = 14, className }) => (
  <svg width={size} height={size} viewBox="0 0 14 14" fill="none" className={className} aria-hidden="true">
    <path
      d="M3.5 5.25L7 8.75L10.5 5.25"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);
