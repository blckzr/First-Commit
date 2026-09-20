import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { useMutation } from "@tanstack/react-query";
import { Button } from "../../components/core/Button";
import { Icon } from "../../components/core/Icon";
import { Input } from "../../components/forms/Input";
import { authApi } from "../../api/auth";
import { ApiError } from "../../api/client";
import { useSessionActions } from "../../features/auth/useSession";
import styles from "./LogIn.module.css";

/**
 * design.md §5.3 — log in.
 *
 * "Failed logins say only: 'Email or password is incorrect.'" That message
 * comes from the API, which gives the same answer for a wrong password and an
 * address that was never registered (docs/database-schema.md §6.3). Nothing
 * here should try to be more helpful than that.
 */
export function LogIn() {
  const navigate = useNavigate();
  const location = useLocation();
  const { setSession } = useSessionActions();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  /**
   * §5.3: "Anyone who was sent to log in from a protected page" goes back to
   * that page. The guards put it in location state; otherwise the API says
   * where to go, since it knows the role and the onboarding step.
   */
  const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname;

  const logIn = useMutation({
    mutationFn: authApi.logIn,
    onSuccess(result) {
      setSession(result.user);
      void navigate(from ?? result.next, { replace: true });
    },
  });

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);

    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");

    const errors: Record<string, string> = {};
    if (!email) errors.email = "Enter your email address.";
    if (!password) errors.password = "Enter your password.";

    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    logIn.mutate({ email, password });
  }

  const error = logIn.error instanceof ApiError ? logIn.error : null;

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <span className={styles.wordmark}>
          <span className={styles.mark}><Icon name="code-xml" size={15} /></span>
          First Commit
        </span>

        <h1 className={styles.title}>Log in</h1>

        <form className={styles.form} onSubmit={onSubmit} noValidate>
          <Input
            label="Email"
            name="email"
            type="email"
            autoComplete="email"
            error={fieldErrors.email}
          />
          <Input
            label="Password"
            name="password"
            type="password"
            autoComplete="current-password"
            error={fieldErrors.password}
          />

          <Link className={styles.forgot} to="/forgot-password">
            Forgot password
          </Link>

          {/*
            One message, above the button, never under a field: saying which of
            the two was wrong is exactly what §6.3 refuses to reveal.
          */}
          {error && (
            <p role="alert" className={styles.formError}>
              {error.message}
            </p>
          )}

          <Button
            type="submit"
            variant="primary"
            fullWidth
            loading={logIn.isPending}
            loadingLabel="Logging in…"
          >
            Log in
          </Button>
        </form>

        <p className={styles.footer}>
          New here? <Link to="/signup">Create an account</Link>
        </p>
      </div>
    </div>
  );
}
