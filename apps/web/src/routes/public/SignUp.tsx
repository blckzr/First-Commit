import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { useMutation } from "@tanstack/react-query";
import { Button } from "../../components/core/Button";
import { Checkbox } from "../../components/forms/Checkbox";
import { Icon } from "../../components/core/Icon";
import { Input } from "../../components/forms/Input";
import { authApi } from "../../api/auth";
import { ApiError } from "../../api/client";
import { useSessionActions } from "../../features/auth/useSession";
import styles from "./SignUp.module.css";

/**
 * design.md §5.2 — sign up creates an account and does nothing else. No
 * sidebar, no bottom navigation, no links into the app.
 *
 * Validation here is a convenience. The API validates again, hashes with
 * argon2id, and is the only thing that creates an account
 * (docs/database-schema.md §6.3).
 */
export function SignUp() {
  const navigate = useNavigate();
  const { setSession } = useSessionActions();

  const [agreed, setAgreed] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const signUp = useMutation({
    mutationFn: authApi.signUp,
    onSuccess(result) {
      setSession(result.user);
      void navigate(result.next);
    },
  });

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);

    const fullName = String(form.get("fullName") ?? "").trim();
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");

    // design.md §9: errors explain and direct, under their own field.
    const errors: Record<string, string> = {};
    if (!fullName) errors.fullName = "Enter the name you want on your certificates.";
    if (!email) errors.email = "Enter your email address.";
    if (password.length < 8) errors.password = "Use at least 8 characters.";

    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    signUp.mutate({ fullName, email, password });
  }

  /**
   * "That email is already registered" belongs under the email field, where
   * the learner is looking. Everything else goes above the button.
   */
  const apiError = signUp.error instanceof ApiError ? signUp.error : null;
  const emailTaken = apiError?.status === 409;

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <span className={styles.wordmark}>
          <span className={styles.mark}><Icon name="code-xml" size={15} /></span>
          First Commit
        </span>

        <h1 className={styles.title}>Create your account</h1>

        <form className={styles.form} onSubmit={onSubmit} noValidate>
          <Input
            label="Full name"
            name="fullName"
            autoComplete="name"
            hint="Use the name you want on your certificates."
            error={fieldErrors.fullName}
          />
          <Input
            label="Email"
            name="email"
            type="email"
            autoComplete="email"
            error={fieldErrors.email ?? (emailTaken ? apiError.message : undefined)}
          />
          <Input
            label="Password"
            name="password"
            type="password"
            autoComplete="new-password"
            hint="At least 8 characters."
            error={fieldErrors.password}
          />

          <Checkbox
            name="consent"
            checked={agreed}
            onChange={(e) => setAgreed(e.currentTarget.checked)}
            className={styles.consent}
            label={
              <>
                I agree to the <Link to="/privacy">Privacy Notice</Link> and{" "}
                <Link to="/terms">Terms of Use</Link>
              </>
            }
          />

          {apiError && !emailTaken && (
            <p role="alert" className={styles.formError}>
              {apiError.message}
            </p>
          )}

          <Button
            type="submit"
            variant="primary"
            fullWidth
            disabled={!agreed}
            loading={signUp.isPending}
            loadingLabel="Creating your account…"
          >
            Create account
          </Button>
        </form>

        <p className={styles.footer}>
          Already have an account? <Link to="/login">Log in</Link>
        </p>
      </div>
    </div>
  );
}
