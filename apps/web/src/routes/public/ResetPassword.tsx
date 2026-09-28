import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useMutation } from "@tanstack/react-query";
import { Button } from "../../components/core/Button";
import { Input } from "../../components/forms/Input";
import { authApi } from "../../api/auth";
import { ApiError } from "../../api/client";
import { AuthFrame } from "./AuthFrame";
import styles from "./Auth.module.css";

/**
 * design.md §5.3 — set a new password. Drawn from First Commit v2.dc.html.
 *
 * Opened from the emailed link, which carries the token in the query string.
 * The token is single use and expires in an hour
 * (docs/database-schema.md §6.3), and the API says so in one message for
 * expired, already used, and never valid alike.
 *
 * Setting a password signs out **every** session, so this always ends at log in
 * — including the session the learner is sitting in right now.
 */
export function ResetPassword() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get("token");

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const reset = useMutation({
    mutationFn: ({ password }: { password: string }) =>
      authApi.resetPassword(token ?? "", password),
    onSuccess(result) {
      void navigate(result.next, { replace: true });
    },
  });

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    const confirm = String(form.get("confirm") ?? "");

    const errors: Record<string, string> = {};
    if (password.length < 8) errors.password = "Use at least 8 characters.";
    // Not an API rule — a courtesy, so a typo does not become a password
    // nobody knows. The API only sees one value.
    else if (confirm !== password) errors.confirm = "This doesn't match the password above.";

    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    reset.mutate({ password });
  }

  const error = reset.error instanceof ApiError ? reset.error : null;

  /** A link with no token at all never had a chance; say so without a round trip. */
  if (!token) {
    return (
      <AuthFrame>
        <div className={styles.heading}>
          <h1 className={styles.title}>That link is incomplete</h1>
          <p className={styles.lede}>
            The address is missing its code, which usually means the link was cut short by a
            mail client. Ask for a new one and open it in full.
          </p>
        </div>
        <p className={styles.footer}>
          <Link to="/forgot-password">Send a new link</Link>
        </p>
      </AuthFrame>
    );
  }

  return (
    <AuthFrame>
      <div className={styles.heading}>
        <h1 className={styles.title}>Set a new password</h1>
        <p className={styles.lede}>This signs you out everywhere else.</p>
      </div>

      <form className={styles.form} onSubmit={onSubmit} noValidate>
        <Input
          label="New password"
          name="password"
          type="password"
          autoComplete="new-password"
          hint="At least 8 characters"
          error={fieldErrors.password}
        />
        <Input
          label="Confirm new password"
          name="confirm"
          type="password"
          autoComplete="new-password"
          error={fieldErrors.confirm}
        />

        {error && (
          <p role="alert" className={styles.formError}>
            {error.message}
            {error.status === 400 && (
              <>
                {" "}
                <Link to="/forgot-password">Send a new link</Link>.
              </>
            )}
          </p>
        )}

        <Button
          type="submit"
          variant="primary"
          fullWidth
          loading={reset.isPending}
          loadingLabel="Saving your password…"
        >
          Save password
        </Button>
      </form>

      <p className={styles.footer}>
        <Link to="/login">Back to log in</Link>
      </p>
    </AuthFrame>
  );
}
