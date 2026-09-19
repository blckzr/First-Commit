import { NavLink, Outlet } from "react-router";
import { Icon } from "../components/core/Icon";
import type { IconName } from "../components/core/Icon";
import { IconButton } from "../components/core/IconButton";
import styles from "./AdminShell.module.css";

interface NavItem {
  to: string;
  label: string;
  icon: IconName;
}

/**
 * design.md §4.2 — the admin sidebar is grouped by purpose, with Overview
 * above the groups.
 */
const OVERVIEW: NavItem = { to: "/admin", label: "Overview", icon: "circle-dot" };

const GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: "Content",
    items: [
      { to: "/admin/paths", label: "Career paths", icon: "wrench" },
      { to: "/admin/modules", label: "Modules", icon: "code-xml" },
      { to: "/admin/briefs", label: "Capstone projects", icon: "award" },
    ],
  },
  {
    label: "Quality",
    items: [
      { to: "/admin/reviews", label: "Project reviews", icon: "check" },
      { to: "/admin/flags", label: "Flagged AI feedback", icon: "flag" },
      { to: "/admin/analytics", label: "Analytics", icon: "info" },
    ],
  },
  {
    label: "Platform",
    items: [
      { to: "/admin/certificates", label: "Certificates", icon: "award" },
      { to: "/admin/users", label: "Users", icon: "user" },
      { to: "/admin/settings", label: "Settings", icon: "settings" },
      { to: "/admin/log", label: "Activity log", icon: "lock" },
    ],
  },
];

function navLinkClass({ isActive }: { isActive: boolean }) {
  return [styles.navLink, isActive ? styles.navLinkActive : ""].filter(Boolean).join(" ");
}

/**
 * The admin shell.
 *
 * design.md §4.3: this is a different component from LearnerShell — neither
 * renders the other's navigation, and **admin pages contain no links to
 * `/app`**. An admin who also wants to learn uses a separate learner account.
 *
 * Loaded lazily (see app/router.tsx) so a learner's browser never downloads it.
 */
export function AdminShell() {
  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <span className={styles.wordmark}>
          <span className={styles.mark}><Icon name="code-xml" size={14} /></span>
          First <span className={styles.wordmarkAccent}>Commit</span>
        </span>
        <span className={styles.adminFlag}>
          <Icon name="lock" size={12} />
          Admin
        </span>
        <div className={styles.topbarEnd}>
          <IconButton icon="user" label="Your profile" variant="bare" size="sm" />
          <IconButton icon="log-out" label="Log out" variant="bare" size="sm" />
        </div>
      </header>

      <div className={styles.body}>
        <nav className={styles.nav} aria-label="Admin">
          <ul className={styles.navList}>
            <li>
              <NavLink to={OVERVIEW.to} end className={navLinkClass}>
                <Icon name={OVERVIEW.icon} size={18} />
                {OVERVIEW.label}
              </NavLink>
            </li>
          </ul>

          {GROUPS.map((group) => (
            <div key={group.label} className={styles.group}>
              <span className={styles.groupLabel} id={`admin-group-${group.label}`}>
                {group.label}
              </span>
              <ul className={styles.navList} aria-labelledby={`admin-group-${group.label}`}>
                {group.items.map((item) => (
                  <li key={item.to}>
                    <NavLink to={item.to} className={navLinkClass}>
                      <Icon name={item.icon} size={18} />
                      {item.label}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <main className={styles.main}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
