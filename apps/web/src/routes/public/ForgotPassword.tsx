import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { useMutation } from "@tanstack/react-query";
import { Button } from "../../components/core/Button";
import { Icon } from "../../components/core/Icon";
import { Input } from "../../components/forms/Input";
import { authApi } from "../../api/auth";
import { ApiError } from "../../api/client";
import { AuthFrame } from "./AuthFrame";
import styles from "./Auth.module.css";

/**
 * design.md §5.3 — request a reset link. Drawn from First Commit v2.dc.html:
 * "Reset your password", then "Check your email" in the same panel.
 *
 * "Reset requests always say 'If that email has an account, a reset link is on
 * its way,' so the page never reveals which emails are registered."
 *
 * The API returns that sentence for a registered and an unregistered address
 * alike, and it is shown verbatim. Nothing here may add a cheerier message for
 * the case where mail was actually sent, because this screen does not know —
 * and must not know — which case it is in. "Check your email" is an
 * instruction, not a report, so it holds for both.
 */
export function ForgotPassword() {
  const [fieldError, setFieldError] = useState<string>();
  const sentHeading = useRef<HTMLHeadingElement>(null);

  const request = useMutation({
    mutationFn: authApi.forgotPassword,
  });

  // The form the learner was in has gone; put them on what replaced it.
  useEffect(() => {
    if (request.isSuccess) sentHeading.current?.focus();
  }, [request.isSuccess]);

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
    <AuthFrame>
      {request.isSuccess ? (
        <div className={styles.sent}>
          <span className={styles.sentIcon}>
            <Icon name="mail" size={22} />
          </span>
          <h1 ref={sentHeading} tabIndex={-1} className={styles.title}>
            Check your email
          </h1>
          <p className={styles.lede} role="status">
            {/* Straight from the API, unembellished. */}
            {request.data.message} It works once and expires in one hour. If it does not
            arrive, check your spam folder.
          </p>
        </div>
      ) : (
        <>
          <div className={styles.heading}>
            <h1 className={styles.title}>Reset your password</h1>
            <p className={styles.lede}>
              Enter the email you signed up with. We&apos;ll send a link to set a new
              password.
            </p>
          </div>

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
        </>
      )}

      <p className={styles.footer}>
        <Link to="/login">Back to log in</Link>
      </p>
    </AuthFrame>
  );
}
