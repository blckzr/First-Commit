import { NavLink, Outlet } from "react-router";
import { Icon } from "../components/core/Icon";
import type { IconName } from "../components/core/Icon";
import { IconButton } from "../components/core/IconButton";
import styles from "./LearnerShell.module.css";

interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  /** Capstone stays locked until the Certificate of Completion is earned. */
  locked?: boolean;
}

/** design.md §4.2 — the sidebar carries every destination. */
const SIDEBAR: NavItem[] = [
  { to: "/app", label: "Home", icon: "circle-dot" },
  { to: "/app/roadmaps", label: "Roadmaps", icon: "wrench" },
  { to: "/app/modules", label: "Explore", icon: "search" },
  { to: "/app/capstone", label: "Capstone", icon: "lock", locked: true },
  { to: "/app/resume", label: "Resume", icon: "user" },
  { to: "/app/certificates", label: "Certificates", icon: "award" },
];

/**
 * §4.2 — below 640px the bottom bar carries five: Home, Roadmaps, Capstone,
 * Resume, and More. More opens Explore modules, Certificates, and Settings.
 *
 * Five is not a style choice. Six items do not fit a 320px viewport, which §12
 * requires to reflow without horizontal scrolling.
 */
const BOTTOM: NavItem[] = [
  { to: "/app", label: "Home", icon: "circle-dot" },
  { to: "/app/roadmaps", label: "Roadmaps", icon: "wrench" },
  { to: "/app/capstone", label: "Capstone", icon: "lock", locked: true },
  { to: "/app/resume", label: "Resume", icon: "user" },
];

const MORE: NavItem[] = [
  { to: "/app/modules", label: "Explore modules", icon: "search" },
  { to: "/app/certificates", label: "Certificates", icon: "award" },
  { to: "/app/settings", label: "Settings", icon: "settings" },
];

function linkClass({ isActive }: { isActive: boolean }, locked?: boolean) {
  return [styles.navLink, isActive ? styles.navLinkActive : "", locked ? styles.locked : ""]
    .filter(Boolean)
    .join(" ");
}

function NavItems({ items }: { items: NavItem[] }) {
  return (
    <>
      {items.map((item) => (
        <li key={item.to}>
          <NavLink
            to={item.to}
            end={item.to === "/app"}
            className={(state) => linkClass(state, item.locked)}
            title={item.locked ? "Finish your roadmap to unlock" : undefined}
          >
            <Icon name={item.icon} size={18} />
            <span className={styles.navLabel}>{item.label}</span>
          </NavLink>
        </li>
      ))}
    </>
  );
}

/**
 * design.md §4.3: the learner shell and the admin shell are separate
 * components. Neither renders the other's navigation, and learner pages carry
 * no links into /admin.
 *
 * §11.2: one layout, three widths — bottom bar below 640px, a collapsed icon
 * rail to 1023px, the full sidebar above. All in CSS, with no toggle. Only one
 * of the two navs is in the accessibility tree at a time, because the other is
 * `display: none`.
 */
export function LearnerShell() {
  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <span className={styles.wordmark}>
          <span className={styles.mark}><Icon name="code-xml" size={14} /></span>
          First <span className={styles.wordmarkAccent}>Commit</span>
        </span>
        <div className={styles.topbarEnd}>
          <IconButton icon="bell" label="Notifications" variant="bare" size="sm" />
          <IconButton icon="settings" label="Settings" variant="bare" size="sm" />
        </div>
      </header>

      <div className={styles.body}>
        <nav className={styles.nav} aria-label="Main">
          <ul className={styles.navList}>
            <NavItems items={SIDEBAR} />
          </ul>
        </nav>

        <main className={styles.main}>
          <Outlet />
        </main>
      </div>

      <nav className={styles.bottomNav} aria-label="Main">
        <ul className={styles.navList}>
          <NavItems items={BOTTOM} />
          <li>
            {/* A native disclosure, so it opens with the keyboard and needs no JS. */}
            <details className={styles.more}>
              <summary className={styles.navLink}>
                <Icon name="chevron-down" size={18} />
                <span className={styles.navLabel}>More</span>
              </summary>
              <ul className={styles.moreList}>
                <NavItems items={MORE} />
              </ul>
            </details>
          </li>
        </ul>
      </nav>
    </div>
  );
}
