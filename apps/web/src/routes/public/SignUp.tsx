import { useState } from "react";
import { Link } from "react-router";
import { Button } from "../../components/core/Button";
import { Checkbox } from "../../components/forms/Checkbox";
import { Icon } from "../../components/core/Icon";
import { Input } from "../../components/forms/Input";
import styles from "./SignUp.module.css";

/**
 * design.md §5.2 — sign up creates an account and does nothing else. It has no
 * sidebar, no bottom navigation, and no links into the app.
 *
 * §9: errors appear under their own field and explain what to do, e.g.
 * "That email is already registered. Log in instead."
 *
 * Client-side validation is a convenience only. The API validates again, hashes
 * the password with argon2id, and is the only thing that creates an account
 * (docs/database-schema.md §6.3).
 */
export function SignUp() {
  const [agreed, setAgreed] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <span className={styles.wordmark}>
          <span className={styles.mark}><Icon name="code-xml" size={15} /></span>
          First Commit
        </span>

        <h1 className={styles.title}>Create your account</h1>

        <form
          className={styles.form}
          onSubmit={(e) => { e.preventDefault(); setSubmitted(true); }}
          noValidate
        >
          <Input
            label="Full name"
            name="fullName"
            autoComplete="name"
            required
            hint="Use the name you want on your certificates."
          />
          <Input
            label="Email"
            name="email"
            type="email"
            autoComplete="email"
            required
          />
          <Input
            label="Password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            hint="At least 8 characters."
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

          <Button type="submit" variant="primary" fullWidth disabled={!agreed}>
            Create account
          </Button>

          {submitted && (
            <p role="status">
              The API isn&apos;t connected yet, so nothing was submitted.
            </p>
          )}
        </form>

        <p className={styles.footer}>
          Already have an account? <Link to="/login">Log in</Link>
        </p>
      </div>
    </div>
  );
}
