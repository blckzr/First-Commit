import { useState } from "react";
import { Link } from "react-router";
import { useMutation } from "@tanstack/react-query";
import { Button } from "../../components/core/Button";
import { Icon } from "../../components/core/Icon";
import { Input } from "../../components/forms/Input";
import { authApi } from "../../api/auth";
import { ApiError } from "../../api/client";
import styles from "./PasswordReset.module.css";

/**
 * design.md §5.3 — request a reset link.
 *
 * "Reset requests always say 'If that email has an account, a reset link is on
 * its way,' so the page never reveals which emails are registered."
 *
 * The API returns that sentence for a registered and an unregistered address
 * alike, and it is shown verbatim. Nothing here may add a cheerier message for
 * the case where mail was actually sent, because this screen does not know —
 * and must not know — which case it is in.
 */
export function ForgotPassword() {
  const [fieldError, setFieldError] = useState<string>();

  const request = useMutation({
    mutationFn: authApi.forgotPassword,
  });

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get("email") ?? "").trim();

    if (!email) {
      setFieldError("Enter your email address.");
      return;
    }
    setFieldError(undefined);
    request.mutate(email);
  }

  const error = request.error instanceof ApiError ? request.error : null;

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <span className={styles.wordmark}>
          <span className={styles.mark}><Icon name="code-xml" size={15} /></span>
          First Commit
        </span>

        <h1 className={styles.title}>Forgot password</h1>
        <p className={styles.lede}>
          Tell us the address on your account and we&apos;ll send a link to set a new
          password.
        </p>

        {request.isSuccess ? (
          <>
            <p className={styles.notice} role="status">
              <Icon name="info" size={18} className={styles.noticeIcon} />
              {/* Straight from the API, unembellished. */}
              <span>
                {request.data.message} The link works once and expires in an hour. If it
                does not arrive, check your spam folder.
              </span>
            </p>
            <p className={styles.footer}>
              <Link to="/login">Back to log in</Link>
            </p>
          </>
        ) : (
          <>
            <form className={styles.form} onSubmit={onSubmit} noValidate>
              <Input
                label="Email"
                name="email"
                type="email"
                autoComplete="email"
                error={fieldError}
              />

              {error && (
                <p role="alert" className={styles.formError}>
                  {error.message}
                </p>
              )}

              <Button
                type="submit"
                variant="primary"
                fullWidth
                loading={request.isPending}
                loadingLabel="Sending the link…"
              >
                Send reset link
              </Button>
            </form>

            <p className={styles.footer}>
              Remembered it? <Link to="/login">Log in</Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
