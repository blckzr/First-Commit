import { NavLink, Outlet, useLocation } from "react-router";
import { Icon } from "../components/core/Icon";
import { LogOutButton } from "../features/auth/LogOutButton";
import type { IconName } from "../components/core/Icon";
import { IconButton } from "../components/core/IconButton";
import { useSession } from "../features/auth/useSession";
import styles from "./LearnerShell.module.css";

interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  /** Capstone stays locked until the Certificate of Completion is earned. */
  locked?: boolean;
}

interface NavGroup {
  id: string;
  label: string;
  /** Where the tab itself goes. A group with items opens its first one. */
  to: string;
  items: NavItem[];
  /** Paths that belong to this group but are not items in it. */
  owns?: string[];
}

/**
 * design.md §4.2 — the learner navigation is two levels, as the prototype has
 * it: three tabs in the top bar, and the tab's destinations in a sidebar panel
 * beneath it. Home has no sidebar because it has nowhere else to go.
 *
 * The paths under `owns` have no navigation item of their own — a module, a
 * quiz, an exercise and the technology choice are all opened *from* a roadmap
 * — so they keep Study lit and the roadmap sidebar in place while they are
 * open, rather than leaving the learner looking at an unlit navigation.
 */
const GROUPS: NavGroup[] = [
  { id: "home", label: "Home", to: "/app", items: [] },
  {
    id: "study",
    label: "Study",
    to: "/app/roadmaps",
    items: [
      { to: "/app/roadmaps", label: "My roadmaps", icon: "map" },
      { to: "/app/explore", label: "Explore modules", icon: "layers" },
      { to: "/app/capstone", label: "Capstone", icon: "wrench", locked: true },
    ],
    owns: ["/app/roadmap/", "/app/module/", "/app/quiz/", "/app/exercise/"],
  },
  {
    id: "career",
    label: "Career",
    to: "/app/resume",
    items: [
      { to: "/app/resume", label: "Resume", icon: "file-text" },
      { to: "/app/certificates", label: "Certificates", icon: "award" },
    ],
  },
];

/**
 * §4.2 — below 640px there is no room for two levels, so the bottom bar
 * carries five: Home, Roadmaps, Capstone, Resume, and More.
 *
 * Five is not a style choice. Six items do not fit a 320px viewport, which §12
 * requires to reflow without horizontal scrolling.
 */
const BOTTOM: NavItem[] = [
  { to: "/app", label: "Home", icon: "circle-dot" },
  { to: "/app/roadmaps", label: "Roadmaps", icon: "map" },
  { to: "/app/capstone", label: "Capstone", icon: "wrench", locked: true },
  { to: "/app/resume", label: "Resume", icon: "file-text" },
];

const MORE: NavItem[] = [
  { to: "/app/explore", label: "Explore modules", icon: "layers" },
  { to: "/app/certificates", label: "Certificates", icon: "award" },
  { to: "/app/settings", label: "Settings", icon: "settings" },
];

/** The group a path belongs to. Home is the fallback, as `/app` itself. */
function groupFor(pathname: string): NavGroup {
  return (
    GROUPS.find(
      (g) =>
        g.items.some((i) => pathname === i.to || pathname.startsWith(`${i.to}/`)) ||
        g.owns?.some((prefix) => pathname.startsWith(prefix)),
    ) ?? GROUPS[0]
  );
}

/** "Jan Kevin Gerona" → "JK". Two letters at most; the disc is 28px. */
function initials(fullName: string | undefined): string {
  const parts = (fullName ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

function NavItems({ items, className }: { items: NavItem[]; className: string }) {
  return (
    <>
      {items.map((item) => (
        <li key={item.to}>
          <NavLink
            to={item.to}
            end={item.to === "/app"}
            className={({ isActive }) =>
              [className, isActive ? styles.itemActive : "", item.locked ? styles.locked : ""]
                .filter(Boolean)
                .join(" ")
            }
            title={item.locked ? "Finish your roadmap to unlock" : undefined}
          >
            <Icon name={item.icon} size={17} />
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
 * The frame is the prototype's: an **ink pill** floating on the page wash
 * carrying the wordmark, the three tabs and the profile menu, then a **white
 * sidebar panel** and the content beside it. Everything is a rounded panel on
 * the wash — §3.3's mosaic — including the bar itself, which is why it is a
 * pill rather than a band across the top.
 *
 * §11.2: below 640px the two levels collapse to one bottom bar, because two
 * rows of navigation above a 320px viewport leaves nothing for the content.
 * Only one nav is in the accessibility tree at a time; the other is
 * `display: none`.
 */
export function LearnerShell() {
  const { pathname } = useLocation();
  const { user } = useSession();
  const group = groupFor(pathname);

  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <span className={styles.wordmark}>
          <span className={styles.mark}><Icon name="code-xml" size={14} /></span>
          First <span className={styles.wordmarkAccent}>Commit</span>
        </span>

        <nav className={styles.tabs} aria-label="Main">
          <ul className={styles.tabList}>
            {GROUPS.map((g) => (
              <li key={g.id}>
                <NavLink
                  to={g.to}
                  end={g.to === "/app"}
                  className={[styles.tab, g.id === group.id ? styles.tabActive : ""]
                    .filter(Boolean)
                    .join(" ")}
                  aria-current={g.id === group.id ? "page" : undefined}
                >
                  {g.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <div className={styles.topbarEnd}>
          <IconButton icon="bell" label="Notifications" variant="bare" size="sm" />
          {/*
            §4.2's profile menu. A native disclosure, so it opens with the
            keyboard and needs no JavaScript.
          */}
          <details className={styles.profile}>
            <summary className={styles.profileButton}>
              <span className={styles.avatar} aria-hidden="true">{initials(user?.fullName)}</span>
              <span className={styles.profileName}>
                {user?.fullName?.split(" ")[0] ?? "Account"}
              </span>
              <Icon name="chevron-down" size={15} />
            </summary>
            <div className={styles.profileMenu}>
              <div className={styles.profileWho}>
                <span className={styles.profileFull}>{user?.fullName}</span>
                <span className={styles.profileEmail}>{user?.email}</span>
              </div>
              <ul className={styles.profileList}>
                <li>
                  <NavLink to="/app/settings" className={styles.profileItem}>
                    <Icon name="user" size={16} />
                    Profile information
                  </NavLink>
                </li>
                <li>
                  <NavLink to="/app/settings" className={styles.profileItem}>
                    <Icon name="settings" size={16} />
                    Account settings
                  </NavLink>
                </li>
                {/*
                  Separated, because it is the one item here that ends the
                  session rather than opening a page.
                */}
                <li className={styles.profileSeparated}>
                  <LogOutButton className={styles.profileItem}>
                    <Icon name="log-out" size={16} />
                    Log out
                  </LogOutButton>
                </li>
              </ul>
            </div>
          </details>
        </div>
      </header>

      <div className={styles.body}>
        {group.items.length > 0 && (
          <nav className={styles.sidebar} aria-label={group.label}>
            <span className={styles.groupLabel}>{group.label}</span>
            <ul className={styles.sidebarList}>
              <NavItems items={group.items} className={styles.sidebarLink} />
            </ul>
          </nav>
        )}

        <main className={styles.main}>
          <Outlet />
        </main>
      </div>

      <nav className={styles.bottomNav} aria-label="Main">
        <ul className={styles.bottomList}>
          <NavItems items={BOTTOM} className={styles.bottomLink} />
          <li>
            <details className={styles.more}>
              <summary className={styles.bottomLink}>
                <Icon name="chevron-down" size={17} />
                <span className={styles.navLabel}>More</span>
              </summary>
              <ul className={styles.moreList}>
                <NavItems items={MORE} className={styles.moreLink} />
              </ul>
            </details>
          </li>
        </ul>
      </nav>
    </div>
  );
}
