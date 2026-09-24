import {
  ArrowLeft, ArrowRight, Award, Bell, Check, ChevronDown, Circle, CircleDot,
  CodeXml, Copy, ExternalLink, FileText, Flag, Info, Layers, Lock, LogOut, Map,
  Plus, Search, Settings, User, Wrench, X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * The single swap point for the icon set.
 *
 * The design system substitutes Lucide for the real icon family (its readme:
 * "only components/core/Icon.jsx needs to change"). It fetched each glyph from
 * unpkg at runtime; we use lucide-react instead, so icons are bundled and
 * tree-shaken rather than requiring a network round trip per glyph.
 *
 * Icons are decorative — they always accompany text (design.md §8: status is
 * never colour alone, and never icon alone either), so they are aria-hidden.
 */
const ICONS = {
  "arrow-left": ArrowLeft,
  "arrow-right": ArrowRight,
  award: Award,
  bell: Bell,
  check: Check,
  "chevron-down": ChevronDown,
  circle: Circle,
  "circle-dot": CircleDot,
  "code-xml": CodeXml,
  copy: Copy,
  "external-link": ExternalLink,
  "file-text": FileText,
  flag: Flag,
  info: Info,
  layers: Layers,
  lock: Lock,
  "log-out": LogOut,
  map: Map,
  plus: Plus,
  search: Search,
  settings: Settings,
  user: User,
  wrench: Wrench,
  x: X,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICONS;

export interface IconProps {
  name: IconName;
  /** 13 inline with captions, 16-18 in buttons and nav, 24 in tiles. */
  size?: number;
  /** Solid fill. The rating star is the only case the system allows. */
  filled?: boolean;
  className?: string;
}

export function Icon({ name, size = 20, filled, className }: IconProps) {
  const Glyph = ICONS[name];
  return (
    <Glyph
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      strokeWidth={1.5}
      fill={filled ? "currentColor" : "none"}
      className={className}
    />
  );
}
