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

const NAV: NavItem[] = [
  { to: "/app", label: "Home", icon: "circle-dot" },
  { to: "/app/roadmaps", label: "Roadmaps", icon: "wrench" },
  { to: "/app/modules", label: "Explore", icon: "search" },
  { to: "/app/capstone", label: "Capstone", icon: "lock", locked: true },
  { to: "/app/resume", label: "Resume", icon: "user" },
  { to: "/app/certificates", label: "Certificates", icon: "award" },
];

/**
 * design.md §4.3: the learner shell and the admin shell are separate
 * components. Neither renders the other's navigation, and learner pages carry
 * no links into /admin.
 *
 * §11.2: one layout, three widths. Bottom navigation below 640px, a collapsed
 * icon rail to 1023px, the full sidebar above — all in CSS, with no toggle.
 */
export function LearnerShell() {
  const nav = (
    <ul className={styles.navList}>
      {NAV.map((item) => (
        <li key={item.to}>
          <NavLink
            to={item.to}
            end={item.to === "/app"}
            className={({ isActive }) =>
              [styles.navLink, isActive ? styles.navLinkActive : "", item.locked ? styles.locked : ""]
                .filter(Boolean).join(" ")
            }
            title={item.locked ? "Finish your roadmap to unlock" : undefined}
          >
            <Icon name={item.icon} size={18} />
            <span className={styles.navLabel}>{item.label}</span>
          </NavLink>
        </li>
      ))}
    </ul>
  );

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
        <nav className={styles.nav} aria-label="Main">{nav}</nav>
        <main className={styles.main}>
          <Outlet />
        </main>
      </div>

      <nav className={styles.bottomNav} aria-label="Main">{nav}</nav>
    </div>
  );
}
