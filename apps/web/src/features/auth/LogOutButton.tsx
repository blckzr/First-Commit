import { useNavigate } from "react-router";
import { useLogOut } from "./useSession";

/**
 * "Log out", for whichever shell renders it.
 *
 * Shared between `LearnerShell` and `AdminShell` deliberately. §8 keeps the two
 * areas in separate code so neither renders the other's *navigation* — this is
 * a control that ends the session, and having one of it means signing out
 * cannot behave differently depending on which area you were in.
 *
 * It renders whatever the surrounding menu or bar needs: the caller passes the
 * class and the children, so the learner's menu item and the admin bar's icon
 * button look like their neighbours rather than like each other.
 */
export interface LogOutButtonProps {
  className?: string;
  children: React.ReactNode;
  /** For an icon-only control, which has no visible text to name it. */
  label?: string;
}

export function LogOutButton({ className, children, label }: LogOutButtonProps) {
  const navigate = useNavigate();
  const logOut = useLogOut();

  return (
    <button
      type="button"
      className={className}
      aria-label={label}
      disabled={logOut.isPending}
      onClick={() => {
        logOut.mutate(undefined, {
          // Navigating in `onSettled` rather than `onSuccess`: a learner who
          // clicked Log out must end up signed out either way.
          onSettled: () => navigate("/login", { replace: true }),
        });
      }}
    >
      {children}
    </button>
  );
}
